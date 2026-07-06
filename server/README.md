# SR Launcher Backend (Render)

Mali auth + config servis. Drzi sve tajne server-side. Igracki launcher zna samo javni `PUBLIC_URL` ovog backenda.

## Sto radi

- OAuth token exchange s Discordom
- Provjera Discord role preko korisnikovog tokena
- Servira centralni config servera iz `servers.json`

## Deploy na Render

1. Napravi Render **Web Service** iz GitHub repo-a.
2. Postavi:
   ```text
   Root Directory: server
   Build Command: npm install
   Start Command: npm start
   ```
3. U **Environment** dodaj:
   ```text
   DISCORD_CLIENT_ID
   DISCORD_CLIENT_SECRET
   DISCORD_GUILD_ID
   DISCORD_REQUIRED_ROLE_ID
   DISCORD_BOT_TOKEN
   JWT_SECRET
   PUBLIC_URL=https://sr-launcher-backend.onrender.com
   ```
4. U Discord Developer Portal dodaj redirect:
   ```text
   https://sr-launcher-backend.onrender.com/auth/callback
   ```

## Provjera

Otvori:

```text
https://sr-launcher-backend.onrender.com/health
```

Trebas vidjeti JSON odgovor s `ok: true`.

## Mijenjanje servera

Uredi `servers.json` i pushaj. Render auto-deploy salje novi config svim igracima bez novog `.exe`, dok god launcher vec koristi isti backend URL.
