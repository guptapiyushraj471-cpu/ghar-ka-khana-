Ghar ka Khana — Ready Bundle

Files included:
- menu.html          : loads /menu.json and renders cards with .jpeg pictures
- menu.json          : aligned fields (id, name, price, img, desc, category, veg), img => /images/<id>.jpeg
- menu.v2.js         : controller (if present); otherwise your latest menu.js
- /images/placeholder.jpeg : tiny fallback so broken images don't crash UI
- /images/expected-images.txt : checklist of filenames you need to copy here

How to deploy:
1) Copy the entire 'site-ready' folder to your static hosting (Render, Netlify, Vercel, or simple Nginx/Apache).
2) Upload your real dish photos into /images/ with exact names listed in expected-images.txt.
3) Ensure the site serves menu.json at /menu.json and images at /images/*.jpeg.
4) Open menu.html — pictures will load automatically.

Optional:
- If your HTML references a specific JS file, include: <script src="/menu.v2.js"></script> before </body>.
