const $ = (s) => document.querySelector(s);
const state = { products:[], category:"", query:"", sort:"featured", cart:JSON.parse(localStorage.getItem("mosey_cart")||"[]"), token:localStorage.getItem("mosey_token")||"", refreshToken:localStorage.getItem("mosey_refresh_token")||"", user:JSON.parse(localStorage.getItem("mosey_user")||"null"), authMode:"login" };
const REMEMBER_EMAIL_KEY = "mosey_remember_email";
const API_BASE = String(window.MOSEY_API_BASE || "").replace(/\/+$/, "");
const SB_MODE = window.MOSEY_MODE === "supabase" && !!window.MOSEY_SUPABASE_URL && !!window.MOSEY_SUPABASE_KEY;
const SB_URL = String(window.MOSEY_SUPABASE_URL || "").replace(/\/+$/, "");
const SB_KEY = String(window.MOSEY_SUPABASE_KEY || "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATIC_PREVIEW = new URLSearchParams(location.search).has("static") || (!API_BASE && !SB_MODE && window.MOSEY_MODE !== "live");
const imageSrc = path => {
  if (!path) return "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80";
  const value = String(path);
  if (/^https?:\/\//i.test(value)) return value;
  if (API_BASE) return API_BASE + (value.startsWith("/") ? value : "/" + value);
  // GitHub Pages serves from a subdirectory, so site-root image paths must be relative there.
  if (SB_MODE && value.startsWith("/")) return value.slice(1);
  return value;
};
let staticCatalogCache = null;
async function staticCatalog(){
  if(!staticCatalogCache){
    const res=await fetch("products.json");
    if(!res.ok)throw new Error("The static catalogue could not be loaded.");
    staticCatalogCache=(await res.json()).map(p=>({...p,image:String(p.image||"").startsWith("/")?p.image.slice(1):p.image}));
  }
  return staticCatalogCache;
}
const money = n => new Intl.NumberFormat("en-KE",{style:"currency",currency:"KES",maximumFractionDigits:0}).format(Number(n)||0);
const WHATSAPP = { local:"0793489901", display:"0793 489 901", international:"+254 793 489 901", wa:"254793489901" };
const waLink = (text="Hello Mosey Shop, I'd like to place an order.") => `https://wa.me/${WHATSAPP.wa}?text=${encodeURIComponent(text)}`;
const escapeHtml = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const statusPill = status => `<span class="status-pill status-${String(status||"").toLowerCase().replace(/\s+/g,"-")}">${escapeHtml(status||"Unknown")}</span>`;
const formatDate = value => { const d=new Date(value); return Number.isNaN(d.getTime()) ? String(value||"") : d.toLocaleString("en-KE",{dateStyle:"medium",timeStyle:"short"}); };
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2800);}
async function api(url, options={}) {
  if(SB_MODE) return sbApi(url, options);
  if(STATIC_PREVIEW){
    const parsed=new URL(url,location.origin);
    if(parsed.pathname==="/api/products"){
      const rows=await staticCatalog();
      const q=(parsed.searchParams.get("q")||"").toLowerCase();
      const cat=parsed.searchParams.get("category")||"";
      return rows.filter(p=>(!cat||p.category===cat)&&(!q||`${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q)));
    }
    if(parsed.pathname==="/api/categories")return [...new Set((await staticCatalog()).map(p=>p.category))].sort();
    throw new Error("Accounts, orders and the assistant need the live store. In this preview you can browse and order on WhatsApp.");
  }
  const headers = {...(options.headers||{})};
  if(state.token) headers.Authorization=`Bearer ${state.token}`;
  if(options.body && !(options.body instanceof FormData)) headers["Content-Type"]="application/json";
  const res=await fetch(API_BASE ? new URL(url, API_BASE).toString() : url,{...options,headers});
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    if(res.status===401 && state.token){state.token="";state.user=null;localStorage.removeItem("mosey_token");localStorage.removeItem("mosey_user");const account=$("#accountBtn");if(account)account.textContent="Sign in";}
    throw new Error(data.error||"Something went wrong.");
  }
  return data;
}

/* Supabase mode: the static site uses Supabase Auth + REST, secured by Row Level Security. */
function sbErrorMessage(data, fallback){
  if(data && typeof data === "object") return data.msg || data.message || data.error_description || data.error || fallback;
  return fallback;
}
async function sbRead(res){
  const text = await res.text();
  if(!text) return {};
  try { return JSON.parse(text); } catch { return { raw:text }; }
}
async function sbStoreSession(session){
  state.token = session?.access_token || "";
  if(session?.refresh_token) state.refreshToken = session.refresh_token;
  if(session?.user){
    const meta = session.user.user_metadata || {};
    state.user = {
      id: session.user.id,
      name: meta.display_name || meta.name || String(session.user.email || "").split("@")[0],
      email: session.user.email || "",
      role: state.user?.role || "customer"
    };
  }
  localStorage.setItem("mosey_token", state.token);
  if(state.refreshToken) localStorage.setItem("mosey_refresh_token", state.refreshToken);
  else localStorage.removeItem("mosey_refresh_token");
  if(state.user) localStorage.setItem("mosey_user", JSON.stringify(state.user));
  const account = $("#accountBtn");
  if(account) account.textContent = state.user?.name?.split(" ")[0] || "Sign in";
}
function sbClearSession(){
  state.token = ""; state.refreshToken = ""; state.user = null;
  localStorage.removeItem("mosey_token");
  localStorage.removeItem("mosey_refresh_token");
  localStorage.removeItem("mosey_user");
  const account = $("#accountBtn");
  if(account) account.textContent = "Sign in";
}
async function sbRefreshSession(){
  if(!state.refreshToken) throw new Error("Session expired. Please sign in again.");
  const data = await sbRequest("/auth/v1/token?grant_type=refresh_token", {
    method:"POST", body: JSON.stringify({ refresh_token: state.refreshToken })
  });
  await sbStoreSession(data);
  return data.access_token;
}
async function sbRequest(path, { method="GET", body, token="", headers={}, retry=true } = {}){
  const requestHeaders = { apikey:SB_KEY, Authorization:`Bearer ${token || SB_KEY}`, ...headers };
  const init = { method, headers:requestHeaders };
  if(body !== undefined){
    if(typeof body === "string" || body instanceof Blob || (typeof FormData !== "undefined" && body instanceof FormData)){
      init.body = body;
      if(typeof body === "string" && !Object.keys(requestHeaders).some(k => k.toLowerCase() === "content-type")) requestHeaders["Content-Type"] = "application/json";
    } else {
      requestHeaders["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(SB_URL + path, init);
  const data = await sbRead(res);
  if(res.status === 401 && token && state.refreshToken && retry){
    try {
      await sbRefreshSession();
      return await sbRequest(path, { method, body, token:state.token, headers, retry:false });
    } catch { sbClearSession(); }
  }
  if(!res.ok){
    const err = new Error(sbErrorMessage(data, "Something went wrong."));
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}
async function sbLoadRole(){
  if(!state.token || !state.user?.id) return;
  try {
    const rows = await sbRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(state.user.id)}&select=role,display_name`, { token:state.token });
    if(rows[0]){
      state.user.role = rows[0].role || "customer";
      if(rows[0].display_name) state.user.name = rows[0].display_name;
      localStorage.setItem("mosey_user", JSON.stringify(state.user));
    }
  } catch {}
}
async function sbCompleteLogin(data){
  await sbStoreSession(data);
  await sbLoadRole();
  return { token:state.token, refreshToken:state.refreshToken, user:state.user };
}
async function sbRequireAdmin(){
  if(!state.token) throw new Error("Please sign in to continue.");
  if(state.user?.role !== "admin") await sbLoadRole();
  if(state.user?.role !== "admin") throw new Error("Administrator access required.");
}
function sbAuthError(err){
  const message = String(err?.message || "");
  if(/email_exists|already registered/i.test(message)) return new Error("An account with that email may already exist.");
  if(/invalid_login_credentials/i.test(message)) return new Error("Email or password is incorrect.");
  if(/weak_password|password.*short|at least/i.test(message)) return new Error("Use a password of at least 8 characters.");
  return err;
}
const sbProduct = p => ({
  id:Number(p.id), name:p.name || "", description:p.description || "", category:p.category || "General",
  price:Number(p.price) || 0, stock:Number(p.stock) || 0, image:p.image_url || p.image || "",
  featured:!!p.featured, active:p.active !== false, created_at:p.created_at
});
const sbOrder = o => ({
  ...o, id:Number(o.id), total:Number(o.total) || 0,
  items:(o.order_items || []).map(i => ({ name:i.product_name, price:Number(i.unit_price) || 0, quantity:Number(i.quantity) || 0 }))
});
function sbLocalChat(products, text, orders=[]){
  const t = String(text || "").toLowerCase();
  const tiles = list => list.slice(0,4).map(p => ({ id:p.id, name:p.name, image:p.image, price:p.price, stock:p.stock, category:p.category }));
  if(/deliver|shipping|shipped|arrive|collection/.test(t)) return { reply:"We deliver within Nairobi and across Kenya. Delivery costs are confirmed before fulfilment, and you can also arrange collection from the store.", products:[] };
  if(/pay|mpesa|payment|whatsapp/.test(t)) return { reply:`Pay by M-Pesa Send Money to ${WHATSAPP.display}, cash on delivery, or bank transfer. WhatsApp is used to confirm your order and payment code — we will never ask for your M-Pesa PIN.`, products:[] };
  if(/order|track|status/.test(t)){
    if(state.token){
      const latest = orders[0];
      return { reply:latest ? `Your latest order is #${latest.id}, currently ${latest.status}, totalling ${money(latest.total)}. You can open “My orders” from your account for the full list.` : "You have not placed an order yet. Add something to your bag, then sign in at checkout.", products:[] };
    }
    return { reply:"Sign in from the top-right of the page, then open “My orders” to track your purchases.", products:[] };
  }
  if(/under|below|cheap|gift|budget|affordable/.test(t)){
    const found = products.filter(p => p.price < 2500).sort((a,b) => a.price - b.price);
    return { reply:found.length ? `Here are affordable picks under ${money(2500)}.` : "Nothing is currently under that budget, but I can show you the full collection.", products:tiles(found) };
  }
  if(/tech|electronic|phone|earbud|headphone|watch|keyboard|speaker|charger|power/.test(t)){
    const found = products.filter(p => p.category === "Electronics");
    return { reply:found.length ? "Here are the tech pieces customers ask about most." : "The tech range is being restocked — please check back soon.", products:tiles(found) };
  }
  if(/home|decor|kitchen|lamp|clock|plant|candle/.test(t)){
    const found = products.filter(p => p.category === "Home");
    return { reply:found.length ? "Here are some home pieces to browse." : "Home pieces are being restocked soon.", products:tiles(found) };
  }
  if(/fashion|style|wear|shoe|bag|hoodie|wallet/.test(t)){
    const found = products.filter(p => p.category === "Fashion");
    return { reply:found.length ? "Here are the fashion pieces in the collection." : "Fashion pieces are being restocked soon.", products:tiles(found) };
  }
  const direct = products.filter(p => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(t));
  if(direct.length) return { reply:`I found ${direct.length} item${direct.length === 1 ? "" : "s"} matching “${text}”.`, products:tiles(direct) };
  return { reply:"I can help with products, prices, delivery and payment. Try “Show me tech” or “Gift under KES 2,000”.", products:tiles(products) };
}
async function sbProductPayload(form, token){
  const name = String(form.get("name") || "").trim();
  const description = String(form.get("description") || "").trim();
  const category = String(form.get("category") || "General").trim() || "General";
  const price = Number(form.get("price"));
  const stock = Number(form.get("stock"));
  if(name.length < 2 || name.length > 120 || description.length > 2000 || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0)
    throw new Error("Enter a valid name, price and whole-number stock.");
  let imageUrl = String(form.get("imageUrl") || "").trim();
  const currentImage = String(form.get("currentImage") || "").trim();
  const file = form.get("image");
  if(file && typeof File !== "undefined" && file instanceof File && file.size){
    if(file.size > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName}`;
    await sbRequest(`/storage/v1/object/product-images/${objectPath}`, { method:"POST", token, body:file, headers:{ "Content-Type":file.type || "application/octet-stream", "x-upsert":"false" } });
    imageUrl = `${SB_URL}/storage/v1/object/public/product-images/${objectPath}`;
  } else if(!imageUrl && currentImage) {
    imageUrl = currentImage;
  }
  const activeValues = typeof form.getAll === "function" ? form.getAll("active") : [];
  return {
    name, description, category, price, stock, image_url:imageUrl,
    featured:String(form.get("featured")) === "1",
    active:activeValues.length ? activeValues.includes("1") : true
  };
}
async function sbApi(url, options={}){
  const parsed = new URL(url, location.origin);
  const path = parsed.pathname;
  const method = String(options.method || "GET").toUpperCase();
  const token = state.token;
  let body = null;
  if(options.body && !(typeof FormData !== "undefined" && options.body instanceof FormData)){
    try { body = typeof options.body === "string" ? JSON.parse(options.body) : options.body; } catch { body = {}; }
  }

  if(path === "/api/auth/register" && method === "POST"){
    const name = String(body?.name || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if(name.length < 2 || name.length > 80 || email.length > 254 || !EMAIL_RE.test(email) || password.length < 8 || password.length > 72)
      throw new Error("Enter your name, a valid email and a password of at least 8 characters.");
    try {
      const data = await sbRequest("/auth/v1/signup", { method:"POST", body: JSON.stringify({ email, password, data:{ display_name:name } }) });
      if(!data.access_token){
        const login = await sbRequest("/auth/v1/token?grant_type=password", { method:"POST", body: JSON.stringify({ email, password }) });
        return await sbCompleteLogin(login);
      }
      return await sbCompleteLogin(data);
    } catch(err) { throw sbAuthError(err); }
  }
  if(path === "/api/auth/login" && method === "POST"){
    try {
      const data = await sbRequest("/auth/v1/token?grant_type=password", { method:"POST", body: JSON.stringify({ email:String(body?.email || "").trim().toLowerCase(), password:String(body?.password || "") }) });
      return await sbCompleteLogin(data);
    } catch(err) { throw sbAuthError(err); }
  }
  if(path === "/api/auth/me") return sbRequest("/auth/v1/user", { token });

  if(path === "/api/products" && method === "GET"){
    const query = state.user?.role === "admin"
      ? "/rest/v1/products?select=*&order=featured.desc,id.desc"
      : "/rest/v1/products?select=*&active=eq.true&order=featured.desc,id.desc";
    const rows = await sbRequest(query);
    const q = String(parsed.searchParams.get("q") || "").trim().toLowerCase();
    const category = String(parsed.searchParams.get("category") || "").trim();
    return rows.map(sbProduct).filter(p => (!category || p.category === category) && (!q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q)));
  }
  if(path === "/api/categories"){
    const rows = await sbRequest("/rest/v1/products?select=category&active=eq.true&order=category.asc");
    return [...new Set(rows.map(r => r.category).filter(Boolean))].sort();
  }
  if(path === "/api/chat" && method === "POST"){
    const products = await api("/api/products");
    let orders = [];
    if(state.token && /my order|track|status/i.test(String(body?.message || ""))){
      try { orders = await api("/api/orders/mine"); } catch {}
    }
    return sbLocalChat(products, body?.message || "", orders);
  }

  if(path === "/api/orders" && method === "POST"){
    if(!token) throw new Error("Please sign in to continue.");
    const items = Array.isArray(body?.items) ? body.items : [];
    const customerName = String(body?.customerName || "").trim();
    const email = String(body?.email || "").trim().toLowerCase();
    const phone = String(body?.phone || "").trim();
    const address = String(body?.address || "").trim();
    const paymentMethod = String(body?.paymentMethod || "").trim();
    if(!items.length || items.length > 50 || customerName.length < 2 || customerName.length > 80 || email.length > 254 || !EMAIL_RE.test(email) || phone.length < 7 || phone.length > 30 || address.length < 8 || address.length > 300)
      throw new Error("Complete valid delivery details and add at least one item.");
    const cleanItems = items.map(i => ({ id:Number(i.id), quantity:Number(i.quantity) }));
    const orderId = await sbRequest("/rest/v1/rpc/place_order", { method:"POST", token, body: JSON.stringify({
      p_customer_name:customerName, p_email:email, p_phone:phone, p_address:address, p_payment_method:paymentMethod, p_items:cleanItems
    }) });
    const total = cleanItems.reduce((sum, item) => sum + (state.cart.find(i => Number(i.id) === item.id)?.price || 0) * item.quantity, 0);
    return { message:"Order placed successfully.", orderId:Number(orderId), total };
  }
  if(path === "/api/orders/mine" && method === "GET"){
    if(!token) throw new Error("Please sign in to continue.");
    const rows = await sbRequest("/rest/v1/orders?select=*,order_items(*)&order=id.desc", { token });
    return rows.map(sbOrder);
  }

  if(path === "/api/admin/summary"){
    await sbRequireAdmin();
    const [products, orders, profiles] = await Promise.all([
      sbRequest("/rest/v1/products?select=id", { token }),
      sbRequest("/rest/v1/orders?select=id,customer_name,total,status,created_at&order=id.desc", { token }),
      sbRequest("/rest/v1/profiles?select=id,role", { token })
    ]);
    return {
      products:products.length, orders:orders.length, customers:profiles.filter(p => p.role !== "admin").length,
      revenue:orders.filter(o => o.status !== "Cancelled").reduce((sum,o) => sum + Number(o.total || 0), 0),
      allOrders:orders.map(o => ({ id:Number(o.id), customer_name:o.customer_name, total:Number(o.total || 0), status:o.status, created_at:o.created_at })),
      recentOrders:orders.slice(0,8).map(o => ({ id:Number(o.id), customer_name:o.customer_name, total:Number(o.total || 0), status:o.status, created_at:o.created_at }))
    };
  }
  if(path === "/api/admin/orders" && method === "GET"){
    await sbRequireAdmin();
    const rows = await sbRequest("/rest/v1/orders?select=*,order_items(*)&order=id.desc", { token });
    return rows.map(sbOrder);
  }
  if(path.startsWith("/api/admin/orders/") && method === "PATCH"){
    await sbRequireAdmin();
    const id = Number(path.split("/").pop());
    await sbRequest("/rest/v1/rpc/set_order_status", { method:"POST", token, body: JSON.stringify({ p_order_id:id, p_status:String(body?.status || "") }) });
    return { message:"Order status updated." };
  }
  if(path === "/api/admin/products" && method === "POST"){
    await sbRequireAdmin();
    if(!(typeof FormData !== "undefined" && options.body instanceof FormData)) throw new Error("Invalid product form.");
    const payload = await sbProductPayload(options.body, token);
    const rows = await sbRequest("/rest/v1/products", { method:"POST", token, headers:{ Prefer:"return=representation" }, body: JSON.stringify(payload) });
    return sbProduct(rows[0] || {});
  }
  if(path.startsWith("/api/admin/products/") && method === "DELETE"){
    await sbRequireAdmin();
    const id = Number(path.split("/").pop());
    await sbRequest(`/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { method:"DELETE", token, headers:{ Prefer:"return=minimal" } });
    return { message:"Product deleted." };
  }
  if(path.startsWith("/api/admin/products/") && method === "PATCH"){
    await sbRequireAdmin();
    const id = Number(path.split("/").pop());
    let patch = {};
    if(typeof FormData !== "undefined" && options.body instanceof FormData) patch = await sbProductPayload(options.body, token);
    else for(const key of ["name","description","category","price","stock","image_url","featured","active"]) if(body?.[key] !== undefined) patch[key] = body[key];
    const rows = await sbRequest(`/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", token, headers:{ Prefer:"return=representation" }, body: JSON.stringify(patch) });
    return sbProduct(rows[0] || {});
  }
  throw new Error("This feature is not available in the Supabase preview.");
}
function saveCart(){localStorage.setItem("mosey_cart",JSON.stringify(state.cart));renderCartCount();}
function renderCartCount(){$("#cartCount").textContent=state.cart.reduce((n,i)=>n+i.quantity,0);}
function openDrawer(html){$("#drawerContent").innerHTML=html;$("#overlay").hidden=false;document.body.style.overflow="hidden";}
function closeDrawer(){$("#overlay").hidden=true;document.body.style.overflow="";}
$("#closeDrawer").addEventListener("click",closeDrawer);
$("#overlay").addEventListener("click",e=>{if(e.target===$("#overlay"))closeDrawer();});
function productCard(p){return `<article class="product-card"><div class="product-image-wrap"><img class="product-image" src="${escapeHtml(imageSrc(p.image))}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.src='https://placehold.co/600x600/f0f2ec/17231f?text=Product'"><span class="product-tag">${p.featured?"POPULAR PICK":escapeHtml(p.category.toUpperCase())}</span><button class="add-button" data-add="${p.id}" aria-label="Add ${escapeHtml(p.name)} to bag">+</button></div><div class="product-meta"><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.category)} · ${p.stock>0?`${p.stock} available`:"Out of stock"}</p></div><span class="price">${money(p.price)}</span></div></article>`;}
const categoryLabel = c => ({Electronics:"Tech", Fashion:"Style", Home:"Home"}[c] || c);
async function loadProducts(){const grid=$("#productGrid");if(!grid)return;try{const params=new URLSearchParams();if(state.query)params.set("q",state.query);if(state.category)params.set("category",state.category);let rows=await api("/api/products?"+params.toString());if(state.sort==="price-asc")rows=[...rows].sort((a,b)=>a.price-b.price);else if(state.sort==="price-desc")rows=[...rows].sort((a,b)=>b.price-a.price);else if(state.sort==="name")rows=[...rows].sort((a,b)=>a.name.localeCompare(b.name));state.products=rows;grid.innerHTML=rows.length?rows.map(productCard).join(""):'<div class="empty-state">No products match your search. Try another term.</div>';const count=$("#productCount");if(count){const where=state.category?` in ${categoryLabel(state.category)}`:"";count.innerHTML=`<b>${rows.length}</b> ${rows.length===1?"product":"products"}${escapeHtml(where)}${state.query?` matching “${escapeHtml(state.query)}”`:""}`;}}catch(e){grid.innerHTML=`<div class="empty-state">${escapeHtml(e.message)}. Is the server running?</div>`;const count=$("#productCount");if(count)count.textContent="The collection could not be loaded.";}}
async function loadFilters(){const box=$("#shopFilters");if(!box)return;try{const cats=await api("/api/categories");box.innerHTML=`<button class="filter active" data-category="">All items</button>`+cats.map(c=>`<button class="filter" data-category="${escapeHtml(c)}">${escapeHtml(categoryLabel(c))}</button>`).join("");const active=box.querySelector(`[data-category="${state.category}"]`);if(active){box.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));active.classList.add("active");}}catch(e){/* keep the static fallback filters */}}
function addToCart(p){if(!p||p.stock<1)return toast("This product is currently out of stock.");const item=state.cart.find(x=>x.id===p.id);if(item){if(item.quantity>=p.stock)return toast("You have reached available stock.");item.quantity++;}else state.cart.push({id:p.id,name:p.name,price:p.price,image:p.image,stock:p.stock,quantity:1});saveCart();toast(`${p.name} added to your bag.`);}
const productGridEl=$("#productGrid");
if(productGridEl)productGridEl.addEventListener("click",e=>{const b=e.target.closest("[data-add]");if(!b)return;addToCart(state.products.find(x=>x.id===Number(b.dataset.add)));});
let searchTimer;
const searchEl=$("#search");
if(searchEl)searchEl.addEventListener("input",e=>{const value=e.target.value.trim();clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=value;loadProducts();},250);});
document.addEventListener("click",e=>{const b=e.target.closest(".filter");if(!b)return;document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.category=b.dataset.category||"";loadProducts();});
if($("#sortProducts"))$("#sortProducts").addEventListener("change",e=>{state.sort=e.target.value;loadProducts();});
if($("#shopNow"))$("#shopNow").onclick=()=>$("#shop").scrollIntoView({behavior:"smooth"});
if($("#promoShop"))$("#promoShop").onclick=()=>{location.href="shop.html";};
function cartView(){const total=state.cart.reduce((n,i)=>n+i.price*i.quantity,0);const cartMessage=state.cart.length?`Hello Mosey Shop! I'd like to order:\n${state.cart.map(i=>`• ${i.name} × ${i.quantity}`).join("\n")}\n\nSubtotal: ${money(total)}. Please confirm availability, delivery and the M-Pesa total.`:"Hello Mosey Shop, I'd like to place an order.";openDrawer(`<p class="eyebrow">YOUR SELECTION</p><h2 id="drawerTitle">Your shopping bag</h2>${state.cart.length?state.cart.map(i=>`<div class="cart-row"><img src="${escapeHtml(i.image?imageSrc(i.image):"")}" alt=""><div><b>${escapeHtml(i.name)}</b><small>${money(i.price)} each</small><div class="qty-control"><button data-qty="${i.id}" data-change="-1">−</button><span>${i.quantity}</span><button data-qty="${i.id}" data-change="1">+</button><button class="link-button danger" data-remove="${i.id}">Remove</button></div></div><b>${money(i.price*i.quantity)}</b></div>`).join(""):`<div class="empty-state">Your bag is waiting for something good.</div>`}<div class="cart-total"><span>Subtotal</span><span>${money(total)}</span></div><p class="muted">Delivery costs, if applicable, can be confirmed by the store before fulfilment.</p>${state.cart.length?`<button class="primary-button" style="width:100%" id="checkoutBtn">Continue to checkout ↗</button><a class="secondary-button" href="${waLink(cartMessage)}" target="_blank" rel="noopener" style="display:block;width:100%;margin-top:10px;text-align:center;box-sizing:border-box">Order on WhatsApp ↗</a>`:""}<p class="muted">Pay by M-Pesa Send Money to <b>${WHATSAPP.display}</b>, or choose cash on delivery at checkout. WhatsApp confirms your order and your payment code.</p>`);
}
$("#cartBtn").onclick=cartView;
$("#drawerContent").addEventListener("click",async e=>{
 const qty=e.target.closest("[data-qty]");if(qty){const id=Number(qty.dataset.qty),item=state.cart.find(i=>i.id===id);if(item){item.quantity+=Number(qty.dataset.change);if(item.quantity<=0)state.cart=state.cart.filter(i=>i.id!==id);if(item.quantity>item.stock)item.quantity=item.stock;saveCart();cartView();}return;}
 const rem=e.target.closest("[data-remove]");if(rem){state.cart=state.cart.filter(i=>i.id!==Number(rem.dataset.remove));saveCart();cartView();return;}
 if(e.target.id==="checkoutBtn"){if(!state.token){signInView("Please sign in or create an account before checkout.");return;}checkoutView();}
 if(e.target.id==="switchAuth"){state.authMode=state.authMode==="login"?"register":"login";authView();}
 if(e.target.id==="logoutBtn"){logout();openDrawer(`<h2>Signed out</h2><p>You have safely signed out of your account.</p>`);}
 if(e.target.id==="showAdmin"){adminLoginView();}
 if(e.target.id==="showLogin"){signInView();}
 if(e.target.id==="myOrdersBtn"){ordersView();}
 if(e.target.id==="adminProductsBtn"){adminProductsView();}
 if(e.target.id==="adminOrdersBtn"){adminOrdersView();}
 if(e.target.id==="addProductBtn"){addProductView();}
});
function signInView(message=""){state.authMode="login";authView(message);}
function authView(message=""){if(STATIC_PREVIEW){openDrawer(`<p class="eyebrow">LIVE STORE FEATURES</p><h2 id="drawerTitle">Sign-in is not in this preview</h2><div class="notice">This GitHub page is a static preview, so accounts, orders and the shopping assistant are not available here. You can still browse the collection, add items to your bag and use <a href="whatsapp.html">WhatsApp ordering</a> to place an order.</div><p class="muted">Run the app locally or use the deployed store for sign-in and order tracking.</p>`);return;}const reg=state.authMode==="register";const remembered=localStorage.getItem(REMEMBER_EMAIL_KEY)||"";openDrawer(`<p class="eyebrow">YOUR MOSEY ACCOUNT</p><h2 id="drawerTitle">${reg?"Create your account":"Welcome back."}</h2><p>${message?escapeHtml(message):reg?"Join us to checkout and keep track of your orders.":"Sign in to continue shopping and view your orders."}</p><form class="form-stack" id="authForm">${reg?`<label>Full name<input name="name" required autocomplete="name"></label>`:""}<label>Email address<input name="email" type="email" value="${escapeHtml(remembered)}" required autocomplete="email"></label><label>Password<input name="password" type="password" minlength="${reg?8:1}" required autocomplete="${reg?"new-password":"current-password"}"></label>${reg?"":`<label style="display:flex;align-items:center;gap:9px;font-weight:600"><input name="remember" type="checkbox" ${remembered?"checked":""} style="width:auto"> Remember my email on this device</label>`}<button class="primary-button">${reg?"Create account":"Sign in"} ↗</button></form><p class="switch-line">${reg?"Already have an account?":"New to Mosey Shop?"} <button class="link-button" id="switchAuth">${reg?"Sign in":"Create account"}</button></p><hr style="border:0;border-top:1px solid var(--line);margin:28px 0"><button class="secondary-button" id="showAdmin">Administrator sign in</button>`);
}
$("#drawerContent").addEventListener("submit",async e=>{
 if(e.target.id==="authForm"){e.preventDefault();const f=new FormData(e.target),body=Object.fromEntries(f.entries());const reg=state.authMode==="register";const remember=!reg&&!!e.target.elements.remember?.checked;delete body.remember;try{const d=await api("/api/auth/"+(reg?"register":"login"),{method:"POST",body:JSON.stringify(body)});setSession(d);if(remember)localStorage.setItem(REMEMBER_EMAIL_KEY,d.user.email);else if(!reg)localStorage.removeItem(REMEMBER_EMAIL_KEY);toast(`Welcome, ${d.user.name}.`);if(state.cart.length)checkoutView();else accountView();}catch(err){toast(err.message);} }
 if(e.target.id==="checkoutForm"){e.preventDefault();const f=new FormData(e.target);const body=Object.fromEntries(f.entries());body.items=state.cart.map(i=>({id:i.id,quantity:i.quantity}));const paymentMethod=body.paymentMethod;const summary=state.cart.map(i=>`• ${i.name} × ${i.quantity}`).join("\n");try{const d=await api("/api/orders",{method:"POST",body:JSON.stringify(body)});state.cart=[];saveCart();loadProducts();toast(`Order #${d.orderId} placed.`);const confirmation=waLink(`Hello Mosey Shop! I've placed order #${d.orderId} for ${money(d.total)} (${paymentMethod}).\n\n${summary}\n\nName: ${body.customerName}\nPhone: ${body.phone}\nDelivery: ${body.address}\n\nPlease confirm my order${paymentMethod==="M-Pesa via WhatsApp"?` and look out for my M-Pesa payment to ${WHATSAPP.display}`:""}.`);openDrawer(`<p class="eyebrow">ORDER CONFIRMED</p><h2>Thank you for your order.</h2><div class="notice">Your order number is <b>#${d.orderId}</b>. Total: <b>${money(d.total)}</b>. Payment method: <b>${escapeHtml(paymentMethod)}</b>. Save this number for your records.</div>${paymentMethod==="M-Pesa via WhatsApp"?`<div class="notice whatsapp-note">Send <b>${money(d.total)}</b> by M-Pesa Send Money to <b>${WHATSAPP.display}</b>, then share the confirmation code on WhatsApp.</div>`:""}<p>Order status: Pending. The store can update the status from its admin dashboard.</p><a class="primary-button" href="${confirmation}" target="_blank" rel="noopener" style="display:block;text-align:center;box-sizing:border-box">Confirm on WhatsApp ↗</a><button class="secondary-button" id="myOrdersBtn" style="width:100%;margin-top:10px">View my orders ↗</button>`);}catch(err){toast(err.message);}}
 if(e.target.id==="productForm"){
   e.preventDefault();
   const id=e.target.dataset.productId;
   try{
     const f=new FormData(e.target);
     if(id)await api("/api/admin/products/"+id,{method:"PATCH",body:f});
     else await api("/api/admin/products",{method:"POST",body:f});
     toast(id?"Product updated.":"Product added.");
     adminProductsView();loadProducts();
   }catch(err){toast(err.message);}
 }
});
function setSession(d){
  if(SB_MODE){
    state.token=d.token||state.token;
    state.refreshToken=d.refreshToken||state.refreshToken;
    state.user=d.user||state.user;
    localStorage.setItem("mosey_token",state.token);
    if(state.refreshToken)localStorage.setItem("mosey_refresh_token",state.refreshToken);
    if(state.user)localStorage.setItem("mosey_user",JSON.stringify(state.user));
    $("#accountBtn").textContent=state.user?.name?.split(" ")[0]||"Sign in";
    return;
  }
  state.token=d.token;state.user=d.user;localStorage.setItem("mosey_token",state.token);localStorage.setItem("mosey_user",JSON.stringify(state.user));$("#accountBtn").textContent=state.user.name.split(" ")[0];
}
function logout(){
  const token=state.token;
  sbClearSession();
  if(SB_MODE && token)sbRequest("/auth/v1/logout",{method:"POST",token}).catch(()=>{});
}
$("#accountBtn").onclick=()=>state.token?accountView():signInView();
function accountView(){openDrawer(`<p class="eyebrow">YOUR ACCOUNT</p><h2 id="drawerTitle">Hello, ${escapeHtml(state.user?.name||"there")}.</h2><p>${escapeHtml(state.user?.email||"")}</p><button class="primary-button" id="myOrdersBtn" style="width:100%">My orders ↗</button><button class="secondary-button" id="logoutBtn" style="margin-top:12px">Sign out</button>${state.user?.role==="admin"?`<button class="secondary-button" id="showAdmin" style="margin:12px 0 0 8px">Open admin dashboard</button>`:""}`);}
function checkoutView(){if(!state.cart.length)return cartView();const total=state.cart.reduce((n,i)=>n+i.price*i.quantity,0);openDrawer(`<p class="eyebrow">ALMOST YOURS</p><h2 id="drawerTitle">Checkout</h2><p>Order total: <b>${money(total)}</b></p><form id="checkoutForm" class="form-stack"><label>Full name<input name="customerName" required value="${escapeHtml(state.user?.name||"")}" autocomplete="name"></label><label>Email<input name="email" type="email" required value="${escapeHtml(state.user?.email||"")}" autocomplete="email"></label><label>Phone number<input name="phone" type="tel" required placeholder="+254 7XX XXX XXX"></label><label>Delivery address<input name="address" required placeholder="Town, estate, street and delivery details"></label><label>Payment method<select name="paymentMethod" required><option value="Cash on delivery">Cash on delivery</option><option value="M-Pesa on delivery">M-Pesa (confirm on delivery)</option><option value="M-Pesa via WhatsApp">M-Pesa via WhatsApp — pay ${WHATSAPP.display}</option><option value="Bank transfer">Bank transfer (manual confirmation)</option></select></label><div class="notice">M-Pesa payments go to <b>${WHATSAPP.display}</b> by Send Money. WhatsApp is used to confirm your order and M-Pesa code — it never asks for your PIN.</div><button class="primary-button">Place order · ${money(total)} ↗</button><button type="button" class="secondary-button" id="backToCart">Back to bag</button></form>`);$("#backToCart").onclick=cartView;}
async function ordersView(){
  if(!state.token)return signInView("Sign in to view your orders.");
  try{
    const rows=await api("/api/orders/mine");
    const statusNote = status => ({
      Pending:"Awaiting confirmation from the store.",
      Processing:"The store is preparing your order.",
      Shipped:"Your order is on its way.",
      Completed:"This order is complete. Thank you!",
      Cancelled:"This order was cancelled and stock was returned."
    }[status] || "");
    openDrawer(`<p class="eyebrow">YOUR PURCHASES</p><h2 id="drawerTitle">My orders</h2>
      <p class="muted">Every order is shown here, including pending ones. When the store confirms or ships an order, the new status appears here.</p>
      <button class="secondary-button" id="refreshOrders" style="width:100%">Refresh orders ↻</button>
      <h3 class="subhead">Order history</h3>
      ${rows.length?rows.map(o=>`<div class="order-card">
        <div class="order-head"><b>Order #${o.id}</b>${statusPill(o.status)}</div>
        ${statusNote(o.status)?`<p>${escapeHtml(statusNote(o.status))}</p>`:""}
        <p>${o.items.map(i=>`${escapeHtml(i.name)} × ${i.quantity}`).join(", ")}</p>
        <small>${escapeHtml(formatDate(o.created_at))} · ${money(o.total)} · ${escapeHtml(o.payment_method)}</small>
      </div>`).join(""):'<div class="empty-state">You haven’t placed an order yet.</div>'}`);
    const refresh=$("#refreshOrders");
    if(refresh)refresh.onclick=ordersView;
  }catch(e){toast(e.message);}
}
function adminLoginView(){if(state.user?.role==="admin"){adminView();return;}signInView("Use your administrator account. Customer accounts cannot access admin tools.");}
async function adminView(){
  try{
    const s=await api("/api/admin/summary");
    const allOrders=s.allOrders||s.recentOrders||[];
    const pending=allOrders.filter(o=>o.status==="Pending").length;
    openDrawer(`<p class="eyebrow">STORE MANAGEMENT</p><h2 id="drawerTitle">Admin dashboard</h2>
      <p>Signed in as ${escapeHtml(state.user.email)}.</p>
      <div class="admin-stats">
        <div class="stat"><small>Products</small><b>${s.products}</b></div>
        <div class="stat"><small>Orders</small><b>${s.orders}</b></div>
        <div class="stat"><small>Customers</small><b>${s.customers}</b></div>
        <div class="stat"><small>Recorded revenue</small><b style="font-size:20px">${money(s.revenue)}</b></div>
      </div>
      <div class="notice">${pending} order${pending===1?"":"s"} awaiting confirmation.</div>
      <button class="primary-button" id="adminProductsBtn">Manage products & pictures ↗</button>
      <button class="secondary-button" id="adminOrdersBtn" style="margin-top:10px">Update order statuses</button>
      <h3 class="subhead">All orders</h3>
      ${allOrders.length?allOrders.map(o=>`<div class="admin-row"><span><b>#${o.id} · ${escapeHtml(o.customer_name)}</b><br><small>${escapeHtml(formatDate(o.created_at))}</small></span><span>${money(o.total)}<br>${statusPill(o.status)}</span></div>`).join(""):"<p>No orders yet.</p>"}`);
  }catch(e){toast(e.message);if(e.message.includes("Administrator"))signInView(e.message);}
}
async function adminProductsView(){
  try{
    const rows=await api("/api/products");
    state.adminProducts=rows;
    openDrawer(`<p class="eyebrow">INVENTORY</p><h2 id="drawerTitle">Manage products & pictures</h2>
      <p class="muted">Upload a picture or paste an image URL. The picture appears on the product card as soon as you save.</p>
      <button class="primary-button" id="addProductBtn">+ Add a product</button>
      <h3 class="subhead">Catalogue (${rows.length})</h3>
      ${rows.map(p=>`<div class="admin-product-row">
        <img class="admin-thumb" src="${escapeHtml(imageSrc(p.image))}" alt="" onerror="this.src='https://placehold.co/160x160/f0f2ec/17231f?text=Product'">
        <div class="admin-product-info"><b>${escapeHtml(p.name)}</b><br><small>${escapeHtml(p.category)} · Stock ${p.stock} · ${p.active===false?"Hidden":"Visible"}${p.featured?" · Popular":""}</small></div>
        <div class="admin-product-actions"><span>${money(p.price)}</span><button class="link-button" data-edit-product="${p.id}">Edit</button><button class="link-button danger" data-delete-product="${p.id}">Delete</button></div>
      </div>`).join("")}`);
  }catch(e){toast(e.message);}
}
function productFormView(p={}){
  const editing=!!p.id;
  const categories=["Electronics","Fashion","Home","General"];
  openDrawer(`<p class="eyebrow">INVENTORY</p><h2 id="drawerTitle">${editing?"Edit product":"Add product"}</h2>
    <p class="muted">Upload a picture from your device or paste an image URL. The preview below shows what customers will see.</p>
    <form id="productForm" class="form-stack" ${editing?`data-product-id="${p.id}"`:""} enctype="multipart/form-data">
      ${editing?`<input type="hidden" name="currentImage" value="${escapeHtml(p.image||"")}">`:""}
      <label>Product name<input name="name" value="${escapeHtml(p.name||"")}" required></label>
      <label>Description<textarea name="description" rows="3">${escapeHtml(p.description||"")}</textarea></label>
      <label>Category<select name="category">${categories.map(c=>`<option ${p.category===c?"selected":""}>${c}</option>`).join("")}</select></label>
      <label>Price (KES)<input name="price" type="number" min="0" step="1" value="${p.price??""}" required></label>
      <label>Stock quantity<input name="stock" type="number" min="0" step="1" value="${p.stock??1}" required></label>
      <div class="image-field">
        <label>Product picture (JPG, PNG, WEBP or GIF, max 5 MB)<input name="image" id="productImageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
        <img id="productImagePreview" class="image-preview" src="${escapeHtml(p.image?imageSrc(p.image):"")}" alt="Product image preview">
        <label>Or paste an image URL (leave empty to keep the current picture)<input name="imageUrl" id="productImageUrl" type="url" value="${escapeHtml(p.image&&!/^https?:\/\//i.test(p.image)?"":p.image||"")}" placeholder="https://..."></label>
      </div>
      <label style="display:flex;align-items:center;gap:9px"><input name="featured" type="checkbox" value="1" ${p.featured?"checked":""} style="width:auto"> Mark as popular pick</label>
      <label style="display:flex;align-items:center;gap:9px"><input name="active" type="hidden" value="0"><input name="active" type="checkbox" value="1" ${p.active===false?"":"checked"} style="width:auto"> Show this product in the shop</label>
      <button class="primary-button">${editing?"Save changes":"Add product"} ↗</button>
      <button type="button" class="secondary-button" id="cancelProduct">Back to products</button>
    </form>`);
  const input=$("#productImageInput"), url=$("#productImageUrl"), preview=$("#productImagePreview");
  const originalImage = p.image ? imageSrc(p.image) : "";
  if(input)input.addEventListener("change",()=>{
    const file=input.files&&input.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{preview.src=reader.result;};
    reader.readAsDataURL(file);
    if(url)url.value="";
  });
  if(url)url.addEventListener("input",()=>{preview.src=url.value.trim()||originalImage;});
  const cancel=$("#cancelProduct");
  if(cancel)cancel.onclick=adminProductsView;
}
function addProductView(){productFormView();}
function editProductView(p){productFormView(p);}
$("#drawerContent").addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit-product]");
  if(edit){
    const p=(state.adminProducts||[]).find(item=>String(item.id)===String(edit.dataset.editProduct));
    if(p)editProductView(p);
    return;
  }
  const del=e.target.closest("[data-delete-product]");
  if(del){
    if(!confirm("Delete this product from the catalogue?"))return;
    try{await api("/api/admin/products/"+del.dataset.deleteProduct,{method:"DELETE"});toast("Product deleted.");adminProductsView();loadProducts();}
    catch(err){toast(err.message);}
  }
});
async function adminOrdersView(){
  try{
    const rows=await api("/api/admin/orders");
    openDrawer(`<p class="eyebrow">FULFILMENT</p><h2 id="drawerTitle">Manage orders</h2>
      <p class="muted">Change an order's status here. The customer sees the new status in My orders after refreshing.</p>
      ${rows.length?rows.map(o=>`<div class="order-card">
        <div class="order-head"><b>Order #${o.id} · ${escapeHtml(o.customer_name)}</b>${statusPill(o.status)}</div>
        <p>${o.items.map(i=>`${escapeHtml(i.name)} × ${i.quantity}`).join(", ")}</p>
        <small>${escapeHtml(o.email)} · ${escapeHtml(o.phone)}<br>${escapeHtml(o.address)}<br>${money(o.total)} · ${escapeHtml(formatDate(o.created_at))}</small>
        <label class="status-control">Status <select data-order-status="${o.id}">${["Pending","Processing","Shipped","Completed","Cancelled"].map(x=>`<option ${o.status===x?"selected":""}>${x}</option>`).join("")}</select></label>
      </div>`).join(""):"<div class=\"empty-state\">No orders have been placed.</div>"}`);
  }catch(e){toast(e.message);}
}
$("#drawerContent").addEventListener("change",async e=>{const s=e.target.closest("[data-order-status]");if(s){try{await api("/api/admin/orders/"+s.dataset.orderStatus,{method:"PATCH",body:JSON.stringify({status:s.value})});toast("Order status updated.");}catch(err){toast(err.message);}}});
$("#ordersLink").onclick=e=>{e.preventDefault();ordersView();};$("#adminLink").onclick=e=>{e.preventDefault();adminLoginView();};
if($("#newsletterForm"))$("#newsletterForm").addEventListener("submit",e=>{e.preventDefault();toast("Thanks for your interest! Newsletter delivery needs an email service connection.");e.target.reset();});
/* WhatsApp ordering and M-Pesa payment details */
const whatsappForm=$("#whatsappForm");
if(whatsappForm)whatsappForm.addEventListener("submit",e=>{
  e.preventDefault();
  const f=new FormData(whatsappForm);
  const name=String(f.get("name")||"").trim();
  const phone=String(f.get("phone")||"").trim();
  const items=String(f.get("items")||"").trim();
  const address=String(f.get("address")||"").trim();
  const message=`Hello Mosey Shop! I'd like to place an order.\n\nName: ${name}\nPhone: ${phone}\nItems: ${items}\nDelivery address: ${address}\n\nPlease confirm availability, delivery and the M-Pesa total.`;
  window.open(waLink(message),"_blank","noopener");
  toast("Opening WhatsApp with your order details.");
});
function copyText(value){
  if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(value);
  return new Promise((resolve,reject)=>{
    const area=document.createElement("textarea");
    area.value=value;area.setAttribute("readonly","");area.style.cssText="position:fixed;top:-1000px;left:-1000px";
    document.body.appendChild(area);area.select();
    let ok=false;
    try{ok=document.execCommand("copy");}catch{}
    area.remove();
    ok?resolve():reject(new Error("Copy unavailable"));
  });
}
document.querySelectorAll("[data-number]").forEach(button=>{
  button.addEventListener("click",async()=>{
    const number=button.dataset.number;
    try{await copyText(number);toast(`Copied ${number}.`);}
    catch{toast(`M-Pesa number: ${number}`);}
  });
});
const waChatLink=$("#waChatLink");
if(waChatLink&&state.cart.length){
  waChatLink.href=waLink(`Hello Mosey Shop! I'd like to order:\n${state.cart.map(i=>`• ${i.name} × ${i.quantity}`).join("\n")}`);
}
/* Mosey shopping assistant */
const chatState = { history: [], busy: false, open: false, productMap: new Map() };
try {
  const saved = JSON.parse(sessionStorage.getItem("mosey_chat") || "[]");
  if (Array.isArray(saved)) chatState.history = saved.filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string").slice(-20);
} catch {}
const chatEls = {};
function chatSave(){ try { sessionStorage.setItem("mosey_chat", JSON.stringify(chatState.history.slice(-20))); } catch {} }
function chatBubble(role, text, products=[]) {
  const bubble = document.createElement("div");
  bubble.className = `chat-msg ${role}`;
  const body = document.createElement("p");
  body.textContent = text;
  bubble.appendChild(body);
  if (Array.isArray(products) && products.length) {
    const list = document.createElement("div");
    list.className = "chat-products";
    for (const item of products) {
      if (!item || !Number.isFinite(Number(item.id))) continue;
      chatState.productMap.set(Number(item.id), item);
      const tile = document.createElement("div");
      tile.className = "chat-product";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = imageSrc(item.image);
      img.onerror = () => { img.src = "https://placehold.co/120x120/f0f2ec/17231f?text=%2B"; };
      const info = document.createElement("div");
      const name = document.createElement("b");
      name.textContent = item.name;
      const meta = document.createElement("small");
      meta.textContent = `${money(item.price)} · ${item.stock > 0 ? `${item.stock} in stock` : "Out of stock"}`;
      info.append(name, meta);
      const add = document.createElement("button");
      add.type = "button";
      add.dataset.chatAdd = item.id;
      add.textContent = item.stock > 0 ? "Add" : "Sold out";
      add.disabled = item.stock < 1;
      tile.append(img, info, add);
      list.appendChild(tile);
    }
    if (list.children.length) bubble.appendChild(list);
  }
  chatEls.log.appendChild(bubble);
  chatEls.log.scrollTop = chatEls.log.scrollHeight;
}
function chatAdd(role, text, products=[]) {
  chatState.history.push({ role, content: text, products: Array.isArray(products) ? products : [] });
  chatState.history = chatState.history.slice(-20);
  chatSave();
  chatBubble(role, text, products);
}
function chatRenderHistory() {
  chatEls.log.innerHTML = "";
  chatState.productMap.clear();
  for (const entry of chatState.history) chatBubble(entry.role, entry.content, Array.isArray(entry.products) ? entry.products : []);
}
function chatSetOpen(open) {
  chatState.open = open;
  chatEls.panel.hidden = !open;
  chatEls.launch.setAttribute("aria-expanded", String(open));
  chatEls.wrap.classList.toggle("open", open);
  if (open) { chatEls.input.focus(); chatEls.log.scrollTop = chatEls.log.scrollHeight; }
}
async function chatSend(text) {
  const value = String(text || "").trim();
  if (!value || chatState.busy) return;
  const history = chatState.history.slice(-8).map(entry => ({ role: entry.role, content: entry.content }));
  chatAdd("user", value);
  chatEls.input.value = "";
  chatState.busy = true;
  chatEls.send.disabled = true;
  const typing = document.createElement("div");
  typing.className = "chat-msg assistant chat-typing";
  typing.setAttribute("aria-label", "Assistant is typing");
  for (let i = 0; i < 3; i++) typing.appendChild(document.createElement("span"));
  chatEls.log.appendChild(typing);
  chatEls.log.scrollTop = chatEls.log.scrollHeight;
  try {
    const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ message: value, history }) });
    typing.remove();
    chatAdd("assistant", data.reply || "I'm not sure I caught that — could you rephrase?", data.products || []);
  } catch (e) {
    typing.remove();
    chatAdd("assistant", `Sorry — I couldn't respond just now. ${e.message}`);
  } finally {
    chatState.busy = false;
    chatEls.send.disabled = false;
    chatEls.input.focus();
  }
}
function mountChat() {
  if (document.querySelector(".chat-widget")) return;
  const wrap = document.createElement("div");
  wrap.className = "chat-widget";
  wrap.innerHTML = `<button class="chat-launch" id="chatLaunch" type="button" aria-expanded="false" aria-controls="chatPanel"><span class="chat-launch-icon" aria-hidden="true">✦</span><span class="chat-launch-text">Ask Mosey</span></button>
  <section class="chat-panel" id="chatPanel" hidden aria-label="Mosey shopping assistant">
    <header class="chat-head"><div class="chat-head-title"><span class="chat-avatar" aria-hidden="true">✦</span><div><b>Mosey assistant</b><small>Products · delivery · orders</small></div></div><button class="chat-close" id="chatClose" type="button" aria-label="Close assistant">×</button></header>
    <div class="chat-log" id="chatLog" role="log" aria-live="polite"></div>
    <div class="chat-suggestions" id="chatSuggestions"><button type="button" data-chat-suggest="Gift under KES 2,000">Gift under KES 2,000</button><button type="button" data-chat-suggest="Show me tech">Show me tech</button><button type="button" data-chat-suggest="How does delivery work?">Delivery</button><button type="button" data-chat-suggest="How do I pay on WhatsApp?">Pay on WhatsApp</button><button type="button" data-chat-suggest="Track my order">My order</button></div>
    <form class="chat-form" id="chatForm"><input id="chatInput" maxlength="500" autocomplete="off" placeholder="Ask about products, delivery..." aria-label="Message the Mosey assistant"><button class="chat-send" id="chatSend" type="submit" aria-label="Send message">↑</button></form>
  </section>`;
  document.body.appendChild(wrap);
  chatEls.wrap = wrap;
  chatEls.launch = wrap.querySelector("#chatLaunch");
  chatEls.panel = wrap.querySelector("#chatPanel");
  chatEls.close = wrap.querySelector("#chatClose");
  chatEls.log = wrap.querySelector("#chatLog");
  chatEls.suggestions = wrap.querySelector("#chatSuggestions");
  chatEls.form = wrap.querySelector("#chatForm");
  chatEls.input = wrap.querySelector("#chatInput");
  chatEls.send = wrap.querySelector("#chatSend");
  if (chatState.history.length) chatRenderHistory();
  else chatAdd("assistant", "Hi! I'm Mosey, your shopping assistant. Ask me about products, prices, delivery or your order — or tap a suggestion below. Please don't share passwords or card details.");
  chatEls.launch.addEventListener("click", () => chatSetOpen(!chatState.open));
  chatEls.close.addEventListener("click", () => chatSetOpen(false));
  chatEls.form.addEventListener("submit", e => { e.preventDefault(); chatSend(chatEls.input.value); });
  chatEls.suggestions.addEventListener("click", e => { const b = e.target.closest("[data-chat-suggest]"); if (b) chatSend(b.dataset.chatSuggest); });
  chatEls.log.addEventListener("click", e => { const b = e.target.closest("[data-chat-add]"); if (!b) return; addToCart(chatState.productMap.get(Number(b.dataset.chatAdd))); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && chatState.open) chatSetOpen(false); });
}
$("#year").textContent=new Date().getFullYear();
if(state.user)$("#accountBtn").textContent=state.user.name.split(" ")[0];
renderCartCount();loadFilters();loadProducts();if(!STATIC_PREVIEW)mountChat();
