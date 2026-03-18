"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function AuthorizeForm() {
  const params = useSearchParams();
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const state = params.get("state") ?? "";
  const clientId = params.get("client_id") ?? "";

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0e1618",
      color: "#e0e0e0",
      fontFamily: "system-ui, sans-serif",
    }}>
      <form
        method="POST"
        action="/oauth/callback"
        style={{
          background: "#1a2428",
          borderRadius: 12,
          padding: "40px 36px",
          width: 380,
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      >
        <h1 style={{ fontSize: 20, margin: "0 0 8px", color: "#fff" }}>
          DSers MCP Product
        </h1>
        <p style={{ fontSize: 14, margin: "0 0 24px", opacity: 0.7 }}>
          Sign in with your DSers account to authorize access.
        </p>

        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="code_challenge" value={codeChallenge} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="client_id" value={clientId} />

        <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
          DSers Email
        </label>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #333",
            background: "#0e1618",
            color: "#fff",
            fontSize: 14,
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />

        <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
          DSers Password
        </label>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #333",
            background: "#0e1618",
            color: "#fff",
            fontSize: 14,
            marginBottom: 24,
            boxSizing: "border-box",
          }}
        />

        <button
          type="submit"
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 6,
            border: "none",
            background: "#37a169",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Authorize
        </button>

        <p style={{ fontSize: 12, marginTop: 16, opacity: 0.5, textAlign: "center" }}>
          Your credentials are encrypted and stored only in the access token.
          No data is persisted on our servers.
        </p>
      </form>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0e1618" }} />}>
      <AuthorizeForm />
    </Suspense>
  );
}
