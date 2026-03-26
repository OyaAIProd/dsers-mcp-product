import { NextResponse } from "next/server";
import { decryptCode, encrypt, sha256Base64url } from "../../../src/oauth/crypto.js";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let grantType: string | null = null;
    let code: string | null = null;
    let codeVerifier: string | null = null;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      grantType = form.get("grant_type") as string | null;
      code = form.get("code") as string | null;
      codeVerifier = form.get("code_verifier") as string | null;
    } else {
      const body = await request.json();
      grantType = body.grant_type ?? null;
      code = body.code ?? null;
      codeVerifier = body.code_verifier ?? null;
    }

    if (grantType !== "authorization_code") {
      return NextResponse.json(
        { error: "unsupported_grant_type" },
        { status: 400 },
      );
    }

    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Missing code or code_verifier" },
        { status: 400 },
      );
    }

    const payload = decryptCode(code);
    if (!payload) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Invalid or expired authorization code" },
        { status: 400 },
      );
    }

    const computedChallenge = sha256Base64url(codeVerifier);
    if (computedChallenge !== payload.code_challenge) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "PKCE verification failed" },
        { status: 400 },
      );
    }

    const accessToken = encrypt({
      session_id: payload.session_id,
      dsers_state: payload.dsers_state,
      base_url: payload.base_url,
      exp: Date.now() + 6 * 60 * 60 * 1000, // 6h
    });

    if (!accessToken) {
      return NextResponse.json(
        { error: "server_error", error_description: "Token generation failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 21600,
      scope: "mcp",
    });
  } catch {
    return NextResponse.json(
      { error: "server_error" },
      { status: 500 },
    );
  }
}
