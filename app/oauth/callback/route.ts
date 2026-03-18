import { NextResponse } from "next/server";
import { generateCode } from "../../../src/oauth/crypto.js";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const email = form.get("email") as string | null;
    const password = form.get("password") as string | null;
    const redirectUri = form.get("redirect_uri") as string | null;
    const codeChallenge = form.get("code_challenge") as string | null;
    const state = form.get("state") as string | null;

    if (!email || !password || !redirectUri || !codeChallenge) {
      return new NextResponse("Missing required fields", { status: 400 });
    }

    const loginResp = await fetch(
      "https://bff-api-gw.dsers.com/account-user-bff/v1/users/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );

    if (!loginResp.ok) {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "Invalid DSers credentials");
      if (state) url.searchParams.set("state", state);
      return NextResponse.redirect(url.toString(), 302);
    }

    const loginData = await loginResp.json();
    if (!loginData?.data?.sessionId) {
      const url = new URL(redirectUri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("error_description", "Login failed");
      if (state) url.searchParams.set("state", state);
      return NextResponse.redirect(url.toString(), 302);
    }

    const env = (form.get("env") as string) || "production";
    const code = generateCode(email, password, env, codeChallenge);
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
