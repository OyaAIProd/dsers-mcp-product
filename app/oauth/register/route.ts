import { NextResponse } from "next/server";
import { generateClientCredentials } from "../../../src/oauth/crypto.js";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const redirectUris: string[] = body.redirect_uris ?? [];
    const clientName: string = body.client_name ?? "MCP Client";

    const { client_id, client_secret } = generateClientCredentials();

    return NextResponse.json(
      {
        client_id,
        client_secret,
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400 },
    );
  }
}
