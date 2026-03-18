export default function PrivacyPolicyPage() {
  return (
    <div style={{
      maxWidth: 720,
      margin: "0 auto",
      padding: "48px 24px",
      fontFamily: "system-ui, sans-serif",
      color: "#e0e0e0",
      background: "#0e1618",
      minHeight: "100vh",
      lineHeight: 1.7,
    }}>
      <h1 style={{ fontSize: 28, color: "#fff", marginBottom: 8 }}>
        Privacy Policy
      </h1>
      <p style={{ opacity: 0.6, marginBottom: 32 }}>
        Last updated: March 2026
      </p>

      <h2 style={{ fontSize: 18, color: "#fff", marginTop: 32 }}>Overview</h2>
      <p>
        DSers MCP Product (&quot;the Service&quot;) is an open-source MCP server that
        automates product import from AliExpress, Alibaba, and 1688 to Shopify
        or Wix stores via the DSers platform.
      </p>

      <h2 style={{ fontSize: 18, color: "#fff", marginTop: 32 }}>Data Collection</h2>
      <p>
        The Service collects only the data necessary to function:
      </p>
      <ul>
        <li><strong>DSers account credentials</strong> (email and password) — provided by the
        user during the OAuth authorization flow. These are encrypted using
        AES-256-GCM and stored solely within the access token issued to the MCP
        client. No credentials are persisted on our servers.</li>
        <li><strong>Product data</strong> — product titles, prices, images, and variants
        retrieved from DSers during import operations. This data is processed
        in-memory and not stored after the request completes.</li>
      </ul>

      <h2 style={{ fontSize: 18, color: "#fff", marginTop: 32 }}>Data Storage</h2>
      <p>
        The Service operates statelessly. No database or persistent storage is used
        on the server side. User credentials exist only inside the encrypted access
        token held by the MCP client (e.g., Claude).
      </p>

      <h2 style={{ fontSize: 18, color: "#fff", marginTop: 32 }}>Data Retention</h2>
      <p>
        Access tokens expire after 24 hours. Authorization codes expire after 10
        minutes. No user data is retained beyond the lifetime of these tokens.
      </p>

      <h2 style={{ fontSize: 18, color: "#fff", marginTop: 32 }}>Third-Party Sharing</h2>
      <p>
        The Service communicates with the following third-party services on behalf
        of the user:
      </p>
      <ul>
        <li><strong>DSers API</strong> (bff-api-gw.dsers.com) — to authenticate the user
        and perform product import and push operations.</li>
      </ul>
      <p>
        No data is shared with any other third parties, analytics services, or
        advertising networks.
      </p>

      <h2 style={{ fontSize: 18, color: "#fff", marginTop: 32 }}>Usage</h2>
      <p>
        Credentials are used exclusively to authenticate with the DSers API for the
        purpose of importing and pushing products as instructed by the user through
        the MCP client.
      </p>

      <h2 style={{ fontSize: 18, color: "#fff", marginTop: 32 }}>Contact</h2>
      <p>
        For privacy-related inquiries, please open an issue on the{" "}
        <a href="https://github.com/lofder/dsers-mcp-product" style={{ color: "#37a169" }}>
          GitHub repository
        </a>.
      </p>
    </div>
  );
}
