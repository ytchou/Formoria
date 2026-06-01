export const underConstructionHtml = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Formoria 島藏 | Under construction</title>
    <style>
      :root {
        color-scheme: light;
        --background: #FAF8F3;
        --text: #1C1C1C;
        --green: #2F5D50;
        --terracotta: #C4693B;
        --border: #E5E0D8;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        min-height: 100%;
      }

      body {
        margin: 0;
        background: var(--background);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.6;
      }

      main {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 48px 24px;
      }

      .wrap {
        width: min(100%, 600px);
        text-align: center;
      }

      .brand {
        display: inline-flex;
        align-items: baseline;
        gap: 10px;
        margin-bottom: 40px;
        color: var(--green);
        font-weight: 650;
        letter-spacing: 0;
      }

      .brand-primary {
        font-size: 1.25rem;
      }

      .brand-secondary {
        font-size: 1rem;
      }

      .divider {
        width: 72px;
        height: 1px;
        margin: 0 auto 36px;
        background: var(--border);
      }

      h1 {
        margin: 0;
        color: var(--green);
        font-size: clamp(2rem, 7vw, 4rem);
        line-height: 1.08;
        letter-spacing: 0;
        font-weight: 700;
      }

      .eyebrow {
        display: block;
        margin-bottom: 10px;
        font-size: 1rem;
        font-weight: 600;
      }

      .copy {
        margin: 28px auto 0;
        max-width: 520px;
        font-size: 1rem;
      }

      .copy p {
        margin: 0;
      }

      .copy p + p {
        margin-top: 10px;
      }

      .actions {
        margin-top: 36px;
      }

      a {
        color: inherit;
      }

      .sign-in {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 24px;
        border: 1px solid var(--terracotta);
        background: var(--terracotta);
        color: #fff;
        border-radius: 4px;
        font-weight: 650;
        text-decoration: none;
      }

      .caption {
        margin-top: 14px;
        color: var(--green);
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="wrap" aria-labelledby="page-title">
        <div class="brand" aria-label="Formoria 島藏">
          <span class="brand-primary">Formoria</span>
          <span class="brand-secondary">島藏</span>
        </div>
        <div class="divider"></div>
        <h1 id="page-title">
          <span class="eyebrow">即將上線</span>
          Under construction
        </h1>
        <div class="copy">
          <p>We're putting the finishing touches on Taiwan's Made-in-Taiwan brand directory — please check back in a few days.</p>
          <p>網站即將上線，請過幾天再回來看看。</p>
        </div>
        <div class="actions">
          <a class="sign-in" href="/auth/sign-in">Sign in</a>
          <div class="caption">Brand partners &amp; team can sign in to preview.</div>
        </div>
      </section>
    </main>
  </body>
</html>
`
