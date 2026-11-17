# Mosey Shop — Online Shopping System

A responsive, full-stack starter project inspired by the two supplied visual references: modern product presentation plus a dark, application-style admin workflow.

## Features
- Responsive storefront with 20 demo products, search and category filters
- Dedicated Shop page listing the full catalogue with category filters, sorting and product counts
- AI shopping assistant chat on every page: product picks, add-to-bag, prices/stock and delivery answers
- WhatsApp page for chat/order confirmation and M-Pesa Send Money payment to 0793 489 901
- Shopping bag with quantity controls and persistent browser cart
- Customer registration/login with hashed passwords and JWT sessions
- Checkout (including an “M-Pesa via WhatsApp” option) and order history
- Separate admin dashboard with sales summary, inventory/product creation, image uploads, order listing and order-status updates
- SQLite database created automatically and demo products seeded on first run
- Stock validation when an order is placed

## Requirements
- Node.js 20 or later
- Internet connection for Google Fonts and the sample Unsplash product images (replace these with your own licensed product images for production)

## GitHub Pages static preview
The `main` branch publishes the `public/` folder to GitHub Pages at
https://kariukimoses.is-a.dev/mosey-online-shopping-system/
(also reachable at https://kariukimoses-254.github.io/mosey-online-shopping-system/, which redirects to the custom domain).

The preview is connected to Supabase, so browsing, sign-up/sign-in, checkout, order tracking, the admin dashboard and the built-in shopping assistant all work there. `public/app-config.js` selects the mode: `supabase` for GitHub Pages, while the Express server overrides that route with `live` for local/Node deployments. `public/products.json` remains as an offline fallback when the site is opened with `?static=1`.

## Run locally
1. Extract the ZIP.
2. Open a terminal inside the extracted `mosey_online_shopping_system` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Copy `.env.example` to `.env` and set a long random `JWT_SECRET`. Change the admin password before using the site.
5. Start:
   ```bash
   npm run dev
   ```
   or `npm start`.
6. Open `http://localhost:5000`.

## GitHub Pages + Supabase (active setup)

The GitHub Pages preview uses Supabase Auth and the REST API directly with a publishable key and Row Level Security. `supabase/setup.sql` contains the full database schema, policies, stock-safe `place_order` RPC, admin `set_order_status` RPC and seed products.

To reproduce it in a new Supabase project:
1. Create a free project and run `supabase/setup.sql` in the SQL Editor.
2. In **Authentication → Sign In / Providers**, leave Email enabled and turn **Confirm email** off.
3. Copy the Project URL and publishable key into `public/app-config.js`.
4. To grant admin access to a customer account, run:
   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

Never put a Supabase secret/service-role key in `public/app-config.js`.

## Deploy the full app (Render)

The Express + SQLite app is an alternative to Supabase for a single-origin deployment. To deploy it:

1. Push this repository to GitHub (the `main` branch already builds the Pages preview).
2. Sign in at https://render.com with GitHub and choose **New + → Blueprint**.
3. Connect `kariukimoses-254/mosey-online-shopping-system`; Render detects `render.yaml`.
4. Review the settings (`npm install` / `node server.js`) and click **Apply**.
5. Open the generated `https://mosey-shop-xxxx.onrender.com` URL — it serves the storefront and API from one origin, so sign-in works there.

Default admin on a fresh deployment: `admin@example.com` / `ChangeMe123!`. Change `ADMIN_PASSWORD` in the Render dashboard and restart the service before sharing the site.

> Note: Render's free plan uses an ephemeral filesystem, so SQLite data (new accounts and orders) is reset when the service restarts or redeploys. Add a persistent disk on a paid plan, or migrate to a hosted database, before using it for real orders.

## WhatsApp ordering and M-Pesa payments
The **WhatsApp** page (`whatsapp.html`) connects customers to Mosey Shop on **0793 489 901** (international **+254 793 489 901**).

- **Order confirmation:** customers can send their items, name, phone and delivery address with the built-in message builder or from their bag. Each button opens WhatsApp with a prefilled message.
- **Payments:** customers pay by **M-Pesa Send Money** to **0793 489 901**. Checkout also offers an “M-Pesa via WhatsApp” payment option, and the order-confirmation screen links back to WhatsApp so the customer can share the M-Pesa confirmation code.
- **Important:** WhatsApp itself does not process card or M-Pesa payments. The payment is made in the customer's M-Pesa app/menu, while WhatsApp is used for order and payment confirmation. The store must verify each payment in M-Pesa before fulfilment.
- **Security:** the site never asks for an M-Pesa PIN. Share the number freely, but treat payment confirmation codes as private.

## AI shopping assistant
Every storefront page has an **Ask Mosey** chat. It answers from the live product catalogue and can add products to the bag directly.

- **Default (no setup):** a built-in assistant handles greetings, product search, budgets (for example “Gift under KES 2,000”), price/stock questions, delivery, payment, returns, and order tracking. It works fully offline.
- **Generative AI (optional):** set `OPENAI_API_KEY` in `.env` to route replies through an OpenAI-compatible Chat Completions API. Optionally set `OPENAI_MODEL` (default `gpt-4o-mini`) and `OPENAI_BASE_URL` for compatible providers.
- **Automatic fallback:** if the provider is slow, unavailable, or no key is configured, the built-in assistant replies instead, so the chat never breaks.
- **Privacy:** messages are only sent to your configured provider when a key is set. Do not paste passwords, card numbers, or other sensitive data.
- **Limits:** chat requests are rate limited to protect the API, messages are capped at 500 characters, and the conversation is kept for the browser session only.

## First administrator login
Defaults are only for local development:
- Email: `admin@example.com`
- Password: `ChangeMe123!`

Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, and `JWT_SECRET` in `.env` **before the first run**. The admin account is created when the database is first initialized; changing environment values later does not automatically reset an existing admin password. Delete `data/shop.db` only if you want to reset the local demo database.

## Important before public deployment
This is a functional development starter, not a production-audited commerce platform.
- Use HTTPS, a strong unique JWT secret, and regular backups. Basic security headers and in-memory rate limiting are included; tune them for production (use a shared store if you run multiple instances).
- Add CSRF protections if switching to cookie-based authentication, plus email verification and password reset.
- Integrate a real payment provider if you want automatic reconciliation. The current checkout records a payment-method selection, and M-Pesa payments via WhatsApp are confirmed manually — **the app does not verify that money arrived**.
- Configure shipping, returns, tax/invoice requirements, privacy policy, terms, customer support and transactional emails.
- Restrict CORS to your deployed domain, scan uploaded images, use a durable object store for uploads, and consider PostgreSQL/MySQL for a multi-instance production deployment.
- Product images in the seed data are a mix of bundled files in `public/images` and remote example URLs; confirm usage rights and replace them with your own product images.
- Admin routes are protected by a role check, but additional hardening and deployment testing are required.

## API overview
- `GET /api/health`
- `GET /api/products?q=&category=`
- `GET /api/categories`
- `POST /api/chat` (shopping assistant, rate limited)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/orders` (authenticated)
- `GET /api/orders/mine` (authenticated)
- `GET /api/admin/summary` (admin)
- `GET /api/admin/orders` (admin)
- `PATCH /api/admin/orders/:id` (admin)
- `POST /api/admin/products` (admin, multipart form)
- `PATCH /api/admin/products/:id` (admin)
- `DELETE /api/admin/products/:id` (admin)

Currency display is Kenyan shillings (KES). Change it in `public/app.js` if your store uses another currency.


## Supabase and database security
`supabase/setup.sql` applies Row Level Security so customers can read active products, see only their own orders, and admins can manage products/orders. Checkout and stock changes run inside the `place_order` database function; never expose a service-role key in browser code. Payment collection still requires manual confirmation or a verified payment gateway.
