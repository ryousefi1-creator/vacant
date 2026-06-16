# Going live (so friends can use it)

The dashboard goes on Vercel (public URL). The CV worker keeps running on your
Mac, POSTing live data to it. Two parts; two short logins from you.

## 1. Private GitHub repo
```bash
# one-time login (run this yourself with the ! prefix — it opens a browser):
!gh auth login

# then I run:
gh repo create vacant --private --source="$HOME/HW Forge/Image Recognition" --remote=origin --push
```
(No `gh`? Make an empty private repo at github.com/new, then I add the remote and push.)

## 2. Deploy the dashboard to Vercel
```bash
# one-time login (run with !):
!vercel login

# then I run, from vacant-app/:
cd vacant-app && vercel --prod        # → gives a public URL like https://vacant-xxx.vercel.app
```

## 3. Shared store + token (so the live site actually shares data)
- In the Vercel dashboard → your project → **Storage → add Upstash Redis** (Marketplace,
  free). It auto-adds `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
- Add the write token (I'll generate the secret):
```bash
vercel env add VACANT_TOKEN production      # paste the generated secret
vercel --prod                               # redeploy so env vars take effect
```

## 4. Run the worker against the live site
```bash
cd ~/"HW Forge/Image Recognition"
VACANT_TOKEN=<the-secret> .venv/bin/python scripts/push.py --api https://<your>.vercel.app
```
While this runs on your Mac, friends see live data at the Vercel URL. Close it / Mac
sleeps → the map freezes on the last values (that's when we move the worker to an
always-on box).
```
