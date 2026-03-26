import { NextResponse } from "next/server";
import { generateCode } from "../../../src/oauth/crypto.js";

const BASE_URL = "https://bff-api-gw.dsers.com";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const sessionId = form.get("session_id") as string | null;
    const dsersState = form.get("dsers_state") as string | null;
    const redirectUri = form.get("redirect_uri") as string | null;
    const codeChallenge = form.get("code_challenge") as string | null;
    const state = form.get("state") as string | null;

    if (!sessionId || !dsersState || !redirectUri || !codeChallenge) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    const infoResp = await fetch(
      `${BASE_URL}/account-user-bff/v1/users/info`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Cookie": `sessionId=${sessionId}; state=${dsersState}`,
        },
      },
    );

    if (!infoResp.ok) {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "Invalid DSers session");
      if (state) url.searchParams.set("state", state);
      return NextResponse.redirect(url.toString(), 302);
    }

    const infoData = await infoResp.json();
    if (!infoData?.data?.email) {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "Session validation failed");
      if (state) url.searchParams.set("state", state);
      return NextResponse.redirect(url.toString(), 302);
    }

    const code = generateCode(sessionId, dsersState, BASE_URL, codeChallenge);
    if (!code) {
      return new NextResponse("Server configuration error", { status: 500 });
    }

    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return NextResponse.redirect(url.toString(), 302);
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
