# Auth email templates

Supabase sends a magic **link** by default. Bugsha signs in with a 6-digit **code**, so the templates must render `{{ .Token }}`.

Until the project is managed by the CLI, paste `otp-code.html` into the dashboard for both templates the OTP flow can use:

1. Supabase dashboard → project `bugsha-dev` → **Authentication → Emails → Templates**.
2. Open **Magic Link**. Subject: `Your Bugsha code: {{ .Token }}`. Body: the contents of `otp-code.html`. Save.
3. Open **Confirm sign up**. Same subject and body. Save. (A first-time email address goes through this template.)
4. **Authentication → Providers → Email**: keep "Confirm email" on; set OTP expiry to 600 s; OTP length 6.
5. **Project Settings → Authentication → SMTP**: add Resend/Postmark credentials and set the sender to `Bugsha <noreply@bugsha.com>`. Without custom SMTP the built-in mailer sends from `noreply@mail.app.supabase.io` and is capped at a few emails per hour.

`config.toml` in this folder's parent carries the same templates for `supabase config push` once the CLI is linked.
