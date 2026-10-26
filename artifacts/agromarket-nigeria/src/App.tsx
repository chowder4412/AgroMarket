import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetAccountQueryKey, getGetAdminDashboardQueryKey, getGetCartQueryKey, getGetProductQueryKey, getGetSellerDashboardQueryKey,
  getListOrdersQueryKey, getListProductsQueryKey, getListQuotationsQueryKey,
  getListSellerVerificationsQueryKey, useAddCartItem, useCheckout, useCreateProduct,
  useCreateQuotation, useGetCart, useGetProduct, useGetSellerDashboard,
  useGetAccount, useGetAdminDashboard, useHealthCheck, useListFeaturedFarms, useListOrders,
  useListProducts, useListQuotations, useListSellerVerifications, useRemoveCartItem,
  useRequestAccountRole, useUpdateCartItem, useUpdateProduct, useUpdateSellerOrderStatus,
  useUpdateSellerVerification,
} from '@workspace/api-client-react';
import type { CheckoutInput, Product, ProductCategory, ProductInput, ProductTier, ProductUnit } from '@workspace/api-client-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import {
  ArrowDown, ArrowLeft, ArrowRight, BadgeCheck, Box, Check, CircleHelp,
  Clock3, Filter, Leaf, MapPin, Menu, Minus, PackageCheck, Plus, Search, ShieldCheck,
  ShoppingBag, ShoppingCart, Sprout, Store, Truck, X,
} from 'lucide-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#285b42', colorForeground: '#20372c', colorMutedForeground: '#66766b',
    colorDanger: '#a84335', colorBackground: '#fbf8f0', colorInput: '#f5f0e6',
    colorInputForeground: '#20372c', colorNeutral: '#d9d2c3',
    fontFamily: 'DM Sans', borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbf8f0] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#20372c] font-semibold',
    headerSubtitle: 'text-[#66766b]',
    socialButtonsBlockButtonText: 'text-[#20372c]',
    formFieldLabel: 'text-[#20372c]',
    footerActionLink: 'text-[#285b42] font-semibold',
    footerActionText: 'text-[#66766b]',
    dividerText: 'text-[#66766b]',
    identityPreviewEditButton: 'text-[#285b42]',
    formFieldSuccessText: 'text-[#285b42]',
    alertText: 'text-[#20372c]',
    logoBox: 'mb-2',
    logoImage: 'h-10',
    socialButtonsBlockButton: 'border-[#d9d2c3] bg-[#f5f0e6] hover:bg-[#eee8dc]',
    formButtonPrimary: 'bg-[#285b42] hover:bg-[#1f4b36] text-[#fbf8f0]',
    formFieldInput: 'bg-[#f5f0e6] border-[#d9d2c3] text-[#20372c]',
    footerAction: 'text-[#66766b]',
    dividerLine: 'bg-[#d9d2c3]',
    alert: 'bg-[#f5f0e6]',
    otpCodeFieldInput: 'bg-[#f5f0e6] border-[#d9d2c3]',
    formFieldRow: 'text-[#20372c]',
    main: 'text-[#20372c]',
  },
};

const categories: { value: ProductCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'Everything' }, { value: 'produce', label: 'Fresh produce' },
  { value: 'foodstuff', label: 'Foodstuff' }, { value: 'feeds', label: 'Animal feeds' },
  { value: 'seeds', label: 'Seeds' }, { value: 'fertilizers', label: 'Fertilizers' },
  { value: 'equipment', label: 'Equipment' },
];
const units: ProductUnit[] = ['kg', 'bag', 'crate', 'litre', 'tonne', 'piece'];
const money = (value: number) => `₦${Number(value || 0).toLocaleString('en-NG')}`;
const pretty = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());

function Button({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${className}`} />;
}
function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-wrap items-end justify-between gap-5"><div>{eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-primary">{eyebrow}</p>}<h1 className="serif text-4xl leading-tight tracking-tight md:text-5xl">{title}</h1>{description && <p className="mt-3 max-w-2xl text-muted-foreground">{description}</p>}</div>{action}</div>;
}
function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' | 'info' }) {
  return <div role="status" data-testid={`notice-${tone}`} className={`rounded-xl border px-4 py-3 text-sm ${tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'success' ? 'border-green-200 bg-green-50 text-green-900' : 'border-[#d9d2c3] bg-[#f5f0e6] text-[#42594a]'}`}>{children}</div>;
}
function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse rounded-xl bg-secondary/70 ${className}`} />; }

function Header() {
  const { data: cart } = useGetCart({ query: { queryKey: getGetCartQueryKey(), retry: false } });
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur-xl">
    <div className="shell flex h-[72px] items-center justify-between gap-4">
      <Link href="/" className="flex shrink-0 items-center gap-2.5 text-foreground" data-testid="link-home">
        <span className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground"><Sprout size={22} strokeWidth={2.2} /></span>
        <span className="leading-tight"><span className="block text-[17px] font-bold tracking-tight">AgroMarket</span><span className="block text-[10px] font-semibold uppercase tracking-[.21em] text-muted-foreground">Nigeria</span></span>
      </Link>
      <nav className={`${menuOpen ? 'absolute left-0 right-0 top-[72px] flex flex-col border-b border-border bg-background p-4 shadow-lg' : 'hidden'} items-center gap-1 md:static md:flex md:flex-row md:border-0 md:bg-transparent md:p-0 md:shadow-none`}>
        <Link onClick={() => setMenuOpen(false)} href="/" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-secondary/70" data-testid="link-discover">Discover</Link>
        <Link onClick={() => setMenuOpen(false)} href="/business/quotations" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-secondary/70" data-testid="link-bulk-buying">Bulk buying</Link>
        <Link onClick={() => setMenuOpen(false)} href="/seller" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-secondary/70" data-testid="link-sell">Sell with us</Link>
        <Link onClick={() => setMenuOpen(false)} href="/orders" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-secondary/70" data-testid="link-orders">Orders</Link>
        <Link onClick={() => setMenuOpen(false)} href="/account/role" className="rounded-full px-4 py-2 text-sm font-semibold hover:bg-secondary/70" data-testid="link-account-type">Account type</Link>
      </nav>
      <div className="flex items-center gap-2">
        <Link href="/cart" className="relative inline-flex size-11 items-center justify-center rounded-full border border-border bg-card hover:bg-secondary" aria-label="Open cart" data-testid="link-cart">
          <ShoppingCart size={19} /><span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white" data-testid="text-cart-count">{cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0}</span>
        </Link>
        <Link href="/sign-in" className="hidden rounded-full px-4 py-2 text-sm font-bold text-primary hover:bg-secondary/70 sm:inline-flex" data-testid="link-sign-in">Sign in</Link>
        <button type="button" onClick={() => setMenuOpen(!menuOpen)} className="grid size-11 place-items-center rounded-full border border-border bg-card md:hidden" aria-label="Toggle menu" data-testid="button-mobile-menu">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
    </div>
  </header>;
}

function Footer() {
  return <footer className="mt-20 border-t border-border bg-[#eae7d9] py-10"><div className="shell flex flex-col justify-between gap-7 md:flex-row md:items-center"><div><div className="serif text-2xl">Good food, closer to home.</div><p className="mt-1 text-sm text-muted-foreground">A more direct way to buy from Nigerian farms.</p></div><div className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold"><Link href="/" data-testid="footer-link-discover">Discover</Link><Link href="/business/quotations" data-testid="footer-link-quotations">Bulk orders</Link><Link href="/seller" data-testid="footer-link-seller">For sellers</Link><Link href="/orders" data-testid="footer-link-orders">Your orders</Link></div></div></footer>;
}

function ProductCard({ product }: { product: Product }) {
  const add = useAddCartItem();
  const client = useQueryClient();
  const [added, setAdded] = useState(false);
  const addItem = () => add.mutate({ data: { productId: product.id, quantity: product.minOrder || 1 } }, {
    onSuccess: () => { client.invalidateQueries({ queryKey: getGetCartQueryKey() }); setAdded(true); window.setTimeout(() => setAdded(false), 1800); },
  });
  return <article className="group overflow-hidden rounded-[22px] border border-border bg-card transition-transform duration-200 hover:-translate-y-1" data-testid={`card-product-${product.id}`}>
    <Link href={`/products/${product.id}`} className="relative block aspect-[1.18] overflow-hidden bg-secondary" data-testid={`link-product-${product.id}`}>
      {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" data-testid={`img-product-${product.id}`} /> : <div className="grid h-full place-items-center text-primary/50"><Leaf size={44} /></div>}
      <span className="absolute left-3 top-3 rounded-full bg-background/90 px-3 py-1 text-[10px] font-bold uppercase tracking-[.13em]">{pretty(product.category)}</span>
      {product.verified && <span className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-primary text-primary-foreground" title="Verified farm"><BadgeCheck size={17} /></span>}
    </Link>
    <div className="p-4">
      <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={12} />{product.location || 'Nigeria'} <span className="px-1">·</span>{product.farmName || product.sellerName}</div>
      <Link href={`/products/${product.id}`} className="serif block min-h-14 text-xl leading-6 hover:text-primary" data-testid={`text-product-name-${product.id}`}>{product.name}</Link>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div><span className="text-lg font-bold">{money(product.price)}</span><span className="ml-1 text-xs text-muted-foreground">/ {product.unit}</span><div className="mt-0.5 text-[11px] text-muted-foreground">Min. {product.minOrder} {product.unit}</div></div>
        <Button onClick={addItem} disabled={add.isPending || product.stock <= 0} className={`h-10 px-4 ${added ? 'bg-[#dbe9d8] text-primary' : 'bg-primary text-primary-foreground hover:bg-[#214b37]'}`} data-testid={`button-add-product-${product.id}`}>
          {added ? <Check size={16} /> : <Plus size={16} />}{added ? 'Added' : add.isPending ? 'Adding' : 'Add'}
        </Button>
      </div>
    </div>
  </article>;
}

function ProductGrid({ products, loading, error, onRetry }: { products?: Product[]; loading?: boolean; error?: boolean; onRetry?: () => void }) {
  if (loading) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[.77] rounded-[22px]" />)}</div>;
  if (error) return <Notice>We couldn't load the market just now. <button onClick={onRetry} className="ml-1 underline" data-testid="button-retry-products">Try again</button></Notice>;
  if (!products?.length) return <div className="rounded-3xl border border-dashed border-border bg-card/50 px-5 py-14 text-center"><Leaf size={30} className="mx-auto text-primary" /><h3 className="serif mt-3 text-2xl">Nothing on this shelf yet</h3><p className="mt-1 text-sm text-muted-foreground">Try another search or category.</p></div>;
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>;
}

function Storefront() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ProductCategory | 'all'>('all');
  const [sort, setSort] = useState<'relevance' | 'price_asc' | 'price_desc'>('relevance');
  const params = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(category !== 'all' ? { category } : {}), sort }), [search, category, sort]);
  const products = useListProducts(params);
  const farms = useListFeaturedFarms();
  const health = useHealthCheck();
  return <main className="page-enter">
    <section className="shell pt-7 md:pt-10">
      <div className="relative isolate overflow-hidden rounded-[30px] bg-[#214b37] px-6 py-9 text-[#faf7ee] md:min-h-[390px] md:px-12 md:py-12">
        <div className="absolute -right-24 -top-32 -z-10 h-[460px] w-[460px] rounded-full border border-[#a9c595]/25 md:right-8 md:top-[-125px]"></div>
        <div className="absolute -right-4 top-10 -z-10 h-[330px] w-[330px] rounded-full border border-[#a9c595]/25"></div>
        <div className="absolute bottom-[-80px] right-[11%] -z-10 h-[290px] w-[290px] rounded-full bg-[#b2c48d]/10"></div>
        <p className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#c8d6b6]"><span className="size-2 rounded-full bg-[#de9a6d]"></span> The Nigerian harvest, in your hands</p>
        <h1 className="serif max-w-[660px] text-[42px] leading-[1.02] tracking-[-.035em] sm:text-6xl md:text-[72px]">Good food starts<br className="hidden sm:block" /> closer to home.</h1>
        <p className="mt-5 max-w-[465px] text-sm leading-6 text-[#e0e6d8] md:text-base">Shop fresh produce and farm goods directly from verified Nigerian farms. Clear prices, honest measures, no market-day guesswork.</p>
        <div className="mt-7 flex max-w-[610px] flex-col gap-3 rounded-2xl bg-[#faf7ee] p-2 sm:flex-row">
          <div className="flex flex-1 items-center gap-3 px-3"><Search className="shrink-0 text-primary" size={19} /><input aria-label="Search market" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="What are you looking for?" className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" data-testid="input-market-search" /><button type="button" onClick={() => setSearch('')} className="text-muted-foreground" aria-label="Clear search" data-testid="button-clear-search"><X size={16} /></button></div>
          <button type="button" onClick={() => document.getElementById('market-listings')?.scrollIntoView({ behavior: 'smooth' })} className="rounded-xl bg-accent px-6 py-3 text-sm font-bold text-white hover:bg-[#aa4f32]" data-testid="button-search-market">Find my food <ArrowRight size={16} /></button>
        </div>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#d6e0cd]"><span className="flex items-center gap-1.5"><ShieldCheck size={14} />Verified farms</span><span className="flex items-center gap-1.5"><Box size={14} />Price by unit</span><span className="flex items-center gap-1.5"><Truck size={14} />Local delivery</span></div>
        <div className="absolute bottom-7 right-9 hidden rotate-[-8deg] rounded-lg border border-[#d9e4cf]/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[.2em] text-[#d9e4cf]/70 md:block">From soil to supper</div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {categories.map((item) => <button key={item.value} type="button" onClick={() => setCategory(item.value)} className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${category === item.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-secondary'}`} data-testid={`filter-category-${item.value}`}>{item.label}</button>)}
        <label className="ml-auto flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold"><Filter size={14} /><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="bg-transparent outline-none" aria-label="Sort products" data-testid="select-sort-products"><option value="relevance">Recommended</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></label>
      </div>
    </section>
    <section id="market-listings" className="shell scroll-mt-28 pt-12">
      <PageTitle eyebrow="Market day, any day" title="Picked for your table" description="From a small family farm or a trusted supplier, every listing shows its measure and price upfront." action={<span className="text-sm text-muted-foreground">{products.data?.length ?? 0} listings</span>} />
      <ProductGrid products={products.data} loading={products.isLoading} error={products.isError} onRetry={() => products.refetch()} />
    </section>
    <section className="shell pt-14">
      <div className="mb-6 flex items-end justify-between gap-4"><div><p className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-primary">Know who grows it</p><h2 className="serif text-3xl md:text-4xl">Farms worth knowing</h2></div><span className="hidden items-center gap-1 text-sm font-semibold text-primary md:flex">Rooted in Nigeria <Leaf size={15} /></span></div>
      {farms.isLoading ? <div className="grid gap-3 md:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}</div> : farms.isError ? <Notice>Farm profiles are taking a little longer to arrive.</Notice> : farms.data?.length ? <div className="grid gap-3 md:grid-cols-3">{farms.data.slice(0, 3).map((farm) => <article key={farm.id} className="flex min-h-36 overflow-hidden rounded-2xl border border-border bg-card" data-testid={`card-farm-${farm.id}`}><div className="w-[37%] bg-secondary">{farm.imageUrl && <img src={farm.imageUrl} alt={farm.name} className="h-full w-full object-cover" data-testid={`img-farm-${farm.id}`} />}</div><div className="flex flex-1 flex-col justify-center p-4"><p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[.15em] text-primary">{farm.verified && <BadgeCheck size={13} />}Verified farm</p><h3 className="serif mt-1 text-xl">{farm.name}</h3><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={12} />{farm.location}</p><p className="mt-2 text-xs text-muted-foreground">{farm.productCount} listings · {farm.sellerName}</p></div></article>)}</div> : <p className="text-sm text-muted-foreground">Featured farm profiles will appear here.</p>}
    </section>
    <section className="shell pt-14">
      <div className="flex flex-col justify-between gap-5 rounded-[26px] bg-[#eee8da] p-6 md:flex-row md:items-center md:px-10"><div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-[.18em] text-accent">Buying for a business?</p><h2 className="serif mt-2 text-3xl">Good supply starts with a good conversation.</h2><p className="mt-2 text-sm text-muted-foreground">Request one quote for the quantities your kitchen, shop or production line needs.</p></div><Link href="/business/quotations" className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-[#214b37] md:self-auto" data-testid="link-request-quote">Request a bulk quote <ArrowRight size={16} /></Link></div>
    </section>
    <div className="shell mt-6 text-[11px] text-muted-foreground" data-testid="status-api-health">{health.data ? `Market service ${health.data.status}` : ''}</div>
  </main>;
}

function ProductDetails() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const product = useGetProduct(id, { query: { queryKey: getGetProductQueryKey(id), enabled: Number.isFinite(id) } });
  const add = useAddCartItem();
  const client = useQueryClient();
  const [qty, setQty] = useState(1);
  const [success, setSuccess] = useState(false);
  if (product.isLoading) return <main className="shell page-enter py-10"><Skeleton className="h-[420px]" /></main>;
  if (product.isError || !product.data) return <main className="shell py-14"><Notice>We couldn't find this listing. <Link href="/" className="underline" data-testid="link-return-market">Return to the market</Link></Notice></main>;
  const item = product.data;
  return <main className="shell page-enter py-8 md:py-12"><Link href="/" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-primary" data-testid="link-back-products"><ArrowLeft size={16} />Back to market</Link><div className="grid gap-8 md:grid-cols-[1.08fr_.92fr]">
    <div className="relative min-h-[330px] overflow-hidden rounded-[28px] bg-secondary md:min-h-[520px]">{item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="absolute inset-0 h-full w-full object-cover" data-testid={`img-product-detail-${item.id}`} /> : <div className="grid h-full min-h-[330px] place-items-center text-primary/40"><Leaf size={70} /></div>}{item.verified && <span className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-background px-3 py-2 text-xs font-bold text-primary"><BadgeCheck size={16} />Verified farm</span>}</div>
    <div className="flex flex-col justify-center"><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">{pretty(item.category)} · {item.location}</p><h1 className="serif mt-3 text-4xl leading-tight md:text-5xl" data-testid="text-product-detail-name">{item.name}</h1><p className="mt-4 leading-7 text-muted-foreground">{item.description}</p><div className="mt-6 flex items-center gap-3 border-y border-border py-5"><span className="text-3xl font-bold">{money(item.price)}</span><span className="text-muted-foreground">per {item.unit}</span><span className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">★ {item.rating?.toFixed(1) || 'New'}</span></div>
      <div className="grid grid-cols-2 gap-3 py-5 text-sm"><div><p className="text-xs text-muted-foreground">Grown / supplied by</p><p className="mt-1 font-semibold">{item.farmName || item.sellerName}</p></div><div><p className="text-xs text-muted-foreground">Available stock</p><p className="mt-1 font-semibold">{item.stock} {item.unit}</p></div><div><p className="text-xs text-muted-foreground">Minimum order</p><p className="mt-1 font-semibold">{item.minOrder} {item.unit}</p></div><div><p className="text-xs text-muted-foreground">Seller</p><p className="mt-1 font-semibold">{item.sellerName}</p></div></div>
      {!!item.wholesaleTiers?.length && <div className="rounded-2xl bg-[#eee8da] p-4"><p className="mb-3 text-xs font-bold uppercase tracking-[.14em]">Better prices for bigger baskets</p>{item.wholesaleTiers.map((tier, i) => <div key={i} className="flex justify-between border-t border-border/70 py-2 text-sm"><span>{tier.minQuantity}+ {item.unit}</span><span className="font-bold">{money(tier.unitPrice)} / {item.unit}</span></div>)}</div>}
      <div className="mt-6 flex gap-3"><div className="flex items-center rounded-full border border-border bg-card"><button onClick={() => setQty(Math.max(item.minOrder || 1, qty - 1))} className="grid size-12 place-items-center" aria-label="Decrease quantity" data-testid="button-decrease-quantity"><Minus size={16} /></button><input value={qty} onChange={(e) => setQty(Math.max(item.minOrder || 1, Math.min(item.stock, Number(e.target.value) || 1)))} type="number" className="w-14 bg-transparent text-center font-bold outline-none" aria-label="Quantity" data-testid="input-product-quantity" /><button onClick={() => setQty(Math.min(item.stock, qty + 1))} className="grid size-12 place-items-center" aria-label="Increase quantity" data-testid="button-increase-quantity"><Plus size={16} /></button></div><Button onClick={() => add.mutate({ data: { productId: item.id, quantity: qty } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetCartQueryKey() }); setSuccess(true); } })} disabled={add.isPending || item.stock < qty} className="flex-1 bg-primary text-primary-foreground hover:bg-[#214b37]" data-testid="button-add-detail-cart"><ShoppingBag size={17} />{add.isPending ? 'Adding to basket' : success ? 'Added to your basket' : 'Add to basket'}</Button></div>
      {add.isError && <p className="mt-3 text-sm text-red-700" data-testid="text-add-cart-error">Could not add this item. Please try again.</p>}
    </div>
  </div></main>;
}

function CartPage() {
  const cart = useGetCart({ query: { queryKey: getGetCartQueryKey(), retry: false } });
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const invalidate = () => client.invalidateQueries({ queryKey: getGetCartQueryKey() });
  return <main className="shell page-enter py-9 md:py-12"><PageTitle eyebrow="Your basket" title="Market basket" description="One basket, many good local sellers. Your prices stay clear at every step." />
    {cart.isLoading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div> : cart.isError ? <div className="max-w-xl"><Notice>Sign in to view your saved basket, or try again in a moment. <button onClick={() => cart.refetch()} className="underline" data-testid="button-retry-cart">Retry</button><Link href="/sign-in" className="ml-2 font-bold underline" data-testid="link-cart-sign-in">Sign in</Link></Notice></div> : !cart.data?.items?.length ? <div className="rounded-[28px] border border-dashed border-border bg-card px-6 py-16 text-center"><ShoppingBasketIcon /><h2 className="serif mt-4 text-3xl">Your basket is ready for good things.</h2><p className="mt-2 text-sm text-muted-foreground">Find something fresh from a farm near you.</p><Link href="/" className="mt-6 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground" data-testid="link-start-shopping">Shop the market <ArrowRight size={16} className="ml-2" /></Link></div> : <div className="grid items-start gap-8 lg:grid-cols-[1fr_350px]"><div className="space-y-3">{cart.data.items.map((item) => <article key={item.id} className="flex gap-4 rounded-2xl border border-border bg-card p-3 sm:p-4" data-testid={`row-cart-item-${item.id}`}><div className="size-24 shrink-0 overflow-hidden rounded-xl bg-secondary sm:size-28">{item.imageUrl && <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" data-testid={`img-cart-item-${item.id}`} />}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><div><h2 className="serif text-xl leading-6">{item.name}</h2><p className="mt-1 text-xs text-muted-foreground">From {item.sellerName}</p></div><button onClick={() => remove.mutate({ id: item.id }, { onSuccess: invalidate })} className="self-start rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-red-700" aria-label={`Remove ${item.name}`} data-testid={`button-remove-cart-item-${item.id}`}><X size={16} /></button></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center rounded-full border border-border"><button onClick={() => update.mutate({ id: item.id, data: { quantity: Math.max(1, item.quantity - 1) } }, { onSuccess: invalidate })} className="grid size-9 place-items-center" aria-label="Decrease item quantity" data-testid={`button-decrease-cart-${item.id}`}><Minus size={14} /></button><span className="min-w-8 text-center text-sm font-bold" data-testid={`text-cart-quantity-${item.id}`}>{item.quantity}</span><button onClick={() => update.mutate({ id: item.id, data: { quantity: Math.min(item.stock, item.quantity + 1) } }, { onSuccess: invalidate })} disabled={item.quantity >= item.stock} className="grid size-9 place-items-center" aria-label="Increase item quantity" data-testid={`button-increase-cart-${item.id}`}><Plus size={14} /></button></div><div className="text-right"><div className="font-bold">{money(item.unitPrice * item.quantity)}</div><div className="text-[11px] text-muted-foreground">{money(item.unitPrice)} / {item.unit}</div></div></div></div></article>)}</div>
      <aside className="rounded-[24px] border border-border bg-card p-5 lg:sticky lg:top-24"><h2 className="serif text-2xl">Basket summary</h2><div className="mt-5 flex justify-between text-sm"><span>Items subtotal</span><span className="font-semibold">{money(cart.data.subtotal)}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Delivery details and any applicable delivery costs are confirmed at checkout.</p><div className="mt-4 flex justify-between border-t border-border pt-4"><span className="font-bold">Subtotal</span><strong className="text-xl">{money(cart.data.subtotal)}</strong></div><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Store size={14} />{cart.data.sellerCount} local seller{cart.data.sellerCount === 1 ? '' : 's'}</p><Button onClick={() => setLocation('/checkout')} className="mt-5 w-full bg-primary text-primary-foreground hover:bg-[#214b37]" data-testid="button-proceed-checkout">Continue to checkout <ArrowRight size={16} /></Button><Link href="/" className="mt-4 block text-center text-sm font-semibold text-primary" data-testid="link-continue-shopping">Continue shopping</Link></aside>
    </div>}
    {(update.isError || remove.isError) && <p className="mt-4 text-sm text-red-700" data-testid="text-cart-mutation-error">We couldn't update your basket. Please try again.</p>}
  </main>;
}
function ShoppingBasketIcon() { return <span className="mx-auto grid size-14 place-items-center rounded-full bg-secondary text-primary"><ShoppingCart size={25} /></span>; }

function CheckoutPage() {
  const cart = useGetCart({ query: { queryKey: getGetCartQueryKey(), retry: false } });
  const checkout = useCheckout();
  const [address, setAddress] = useState('');
  const [order, setOrder] = useState<Awaited<ReturnType<typeof checkout.mutateAsync>> | null>(null);
  const client = useQueryClient();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    checkout.mutate({ data: { deliveryAddress: address, paymentMode: 'sandbox' as CheckoutInput['paymentMode'] } }, {
      onSuccess: (created) => { setOrder(created); client.invalidateQueries({ queryKey: getGetCartQueryKey() }); client.invalidateQueries({ queryKey: getListOrdersQueryKey() }); },
    });
  };
  if (order) return <main className="shell page-enter py-10 md:py-16"><div className="mx-auto max-w-3xl rounded-[28px] border border-border bg-card p-6 sm:p-9"><div className="text-center"><span className="mx-auto grid size-16 place-items-center rounded-full bg-[#dcebd8] text-primary"><Check size={30} /></span><p className="mt-5 text-xs font-bold uppercase tracking-[.18em] text-primary">Demo checkout complete</p><h1 className="serif mt-2 text-4xl">Your orders are in the books.</h1><p className="mt-3 text-muted-foreground">Order group <strong data-testid="text-order-group-number">{order.orderGroupNumber}</strong></p><p className="mt-2 text-sm text-muted-foreground">Combined order total <strong className="text-foreground" data-testid="text-checkout-grand-total">{money(order.grandTotal)}</strong></p></div><div className="mt-6 rounded-xl border border-[#d8b88d] bg-[#fff5e5] p-4 text-sm text-[#644b2d]" data-testid="notice-sandbox-payment"><p className="font-bold">Payment simulation: sandbox / demo only</p><p className="mt-1">No money was charged. This creates test order records only; no live payment was processed.</p></div><section className="mt-8"><div className="mb-3 flex items-center justify-between"><h2 className="serif text-2xl">Seller orders</h2><span className="text-xs text-muted-foreground">{order.orders.length} seller{order.orders.length === 1 ? '' : 's'}</span></div><div className="space-y-3">{order.orders.map((sellerOrder) => <article key={sellerOrder.id} className="rounded-2xl border border-border bg-background p-4" data-testid={`card-checkout-order-${sellerOrder.id}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-primary">{sellerOrder.sellerName}</p><p className="mt-1 font-bold" data-testid={`text-checkout-order-number-${sellerOrder.id}`}>{sellerOrder.orderNumber}</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold" data-testid={`status-checkout-order-${sellerOrder.id}`}>{pretty(sellerOrder.status)}</span></div><div className="mt-3 space-y-1 border-t border-border pt-3">{sellerOrder.items.map((item, index) => <p key={`${sellerOrder.id}-${item.productId}-${index}`} className="flex justify-between gap-3 text-sm"><span>{item.quantity} × {item.name}</span><span className="text-muted-foreground">{money(item.unitPrice * item.quantity)}</span></p>)}</div><div className="mt-3 flex justify-between border-t border-border pt-3 text-sm"><span className="text-muted-foreground">Seller order total</span><strong>{money(sellerOrder.total)}</strong></div></article>)}</div></section><div className="mt-7 flex flex-wrap justify-center gap-3"><Link href="/orders" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground" data-testid="link-view-orders">View your orders <ArrowRight size={16} /></Link><Link href="/" className="inline-flex items-center rounded-full border border-border px-6 py-3 text-sm font-bold" data-testid="link-return-market-checkout">Return to market</Link></div></div></main>;
  return <main className="shell page-enter py-9 md:py-12"><PageTitle eyebrow="Sandbox checkout" title="Delivery details" description="Checkout is for demo and testing only. No payment will be collected." />
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_360px]"><form onSubmit={submit} className="space-y-6 rounded-[24px] border border-border bg-card p-5 sm:p-7">
      <div className="flex gap-3 rounded-xl border border-[#d8b88d] bg-[#fff5e5] p-4 text-sm text-[#644b2d]"><CircleHelp size={19} className="mt-0.5 shrink-0" /><div><strong>Sandbox / demo checkout</strong><p className="mt-1">No money is charged. This creates a pending test order only.</p></div></div>
      <label className="block"><span className="mb-2 block text-sm font-bold">Delivery address</span><textarea required minLength={8} rows={4} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="House number, street, area, city and state" className="w-full resize-y rounded-xl border border-input bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/30" data-testid="input-delivery-address" /></label>
      <div className="rounded-xl bg-secondary/60 p-4"><p className="text-sm font-bold">Payment mode</p><p className="mt-1 text-sm text-muted-foreground">Sandbox demo — no live payment method is connected.</p></div>
      {checkout.isError && <Notice>We couldn't create the demo order. Please check your address and try again.</Notice>}
      <Button type="submit" disabled={checkout.isPending || !address.trim() || cart.isLoading || !cart.data?.items?.length} className="w-full bg-primary text-primary-foreground hover:bg-[#214b37]" data-testid="button-place-sandbox-order">{checkout.isPending ? 'Creating demo order…' : 'Create sandbox order'} <ArrowRight size={16} /></Button>
    </form><aside className="rounded-[24px] border border-border bg-card p-5"><h2 className="serif text-2xl">Your basket</h2>{cart.isLoading ? <Skeleton className="mt-4 h-20" /> : cart.isError ? <Notice>Sign in to load your basket. <Link href="/sign-in" className="underline" data-testid="link-checkout-sign-in">Sign in</Link></Notice> : cart.data?.items?.length ? <><div className="mt-4 space-y-3">{cart.data.items.map((item) => <div key={item.id} className="flex justify-between gap-3 text-sm" data-testid={`text-checkout-item-${item.id}`}><span>{item.quantity} × {item.name}</span><span className="font-semibold">{money(item.unitPrice * item.quantity)}</span></div>)}</div><div className="mt-5 flex justify-between border-t border-border pt-4 font-bold"><span>Subtotal</span><span>{money(cart.data.subtotal)}</span></div></> : <p className="mt-4 text-sm text-muted-foreground">Your basket is empty.</p>}</aside></div>
  </main>;
}

function OrdersPage() {
  const orders = useListOrders({ query: { queryKey: getListOrdersQueryKey(), retry: false } });
  return <main className="shell page-enter py-9 md:py-12"><PageTitle eyebrow="Your market trail" title="Orders" description="Keep an eye on what is on its way from the farms and suppliers you chose." />
    {orders.isLoading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div> : orders.isError ? <Notice>Sign in to see your orders. <Link href="/sign-in" className="ml-2 font-bold underline" data-testid="link-orders-sign-in">Sign in</Link></Notice> : !orders.data?.length ? <div className="rounded-[26px] border border-dashed border-border bg-card p-12 text-center"><PackageCheck className="mx-auto text-primary" size={32} /><h2 className="serif mt-4 text-3xl">Your next good find is out there.</h2><p className="mt-2 text-sm text-muted-foreground">When you place an order, it will show up here.</p><Link href="/" className="mt-5 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="link-shop-from-orders">Explore the market</Link></div> : <div className="space-y-4">{orders.data.map((order) => <article key={order.id} className="rounded-[22px] border border-border bg-card p-5" data-testid={`card-order-${order.id}`}><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4"><div><p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</p><h2 className="mt-1 font-bold" data-testid={`text-order-number-${order.id}`}>{order.orderNumber}</h2></div><span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold" data-testid={`status-order-${order.id}`}>{pretty(order.status)}</span></div><div className="grid gap-4 pt-4 sm:grid-cols-[1fr_auto]"><div>{order.items.map((item, index) => <p key={`${item.productId}-${index}`} className="mb-1 text-sm">{item.quantity} × {item.name} <span className="text-muted-foreground">from {item.sellerName}</span></p>)}<p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={12} />{order.deliveryAddress}</p></div><div className="text-right"><p className="text-xs text-muted-foreground">Order total</p><p className="text-xl font-bold" data-testid={`text-order-total-${order.id}`}>{money(order.total)}</p><p className="mt-2 text-xs text-muted-foreground">{pretty(order.paymentStatus)} · {pretty(order.paymentMode)}</p></div></div></article>)}</div>}
  </main>;
}

function SellerDashboard() {
  const dashboard = useGetSellerDashboard({ query: { queryKey: getGetSellerDashboardQueryKey(), retry: false } });
  const products = useListProducts();
  const status = useUpdateSellerOrderStatus();
  const client = useQueryClient();
  const active = dashboard.data;
  const metrics = active ? [
    ['Listed products', active.productCount, 'This is your live catalogue', <Box size={18} />],
    ['Active orders', active.activeOrders, 'Needs fulfilment attention', <Truck size={18} />],
    ['Revenue', money(active.revenueNgn), 'Recorded across your orders', <ArrowDown size={18} />],
    ['Units in stock', active.stockUnits, 'Across your current listings', <PackageCheck size={18} />],
  ] : [];
  return <main className="shell page-enter py-9 md:py-12"><PageTitle eyebrow="Seller workspace" title="Good morning, grower." description="A clear view of your listings, stock and the orders to move next." action={<Link href="/seller/products/new" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="link-create-product"><Plus size={16} /> Add a listing</Link>} />
    {dashboard.isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}</div> : dashboard.isError ? <Notice>Seller overview is available after signing in as a seller. <Link href="/sign-in" className="ml-2 font-bold underline" data-testid="link-seller-sign-in">Sign in</Link></Notice> : <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(([title, value, desc, icon]) => <div key={String(title)} className="rounded-[20px] border border-border bg-card p-5" data-testid={`metric-seller-${String(title).toLowerCase().replaceAll(' ', '-')}`}><span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary">{icon}</span><p className="mt-4 text-xs font-semibold text-muted-foreground">{title}</p><p className="serif mt-1 text-3xl">{value}</p><p className="mt-1 text-xs text-muted-foreground">{desc}</p></div>)}</div>
      <section className="mt-10"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Fulfilment</p><h2 className="serif mt-1 text-3xl">Recent orders</h2></div><span className="text-xs text-muted-foreground">{active?.recentOrders.length ?? 0} recent</span></div>
        {!active?.recentOrders.length ? <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">New orders will appear here.</div> : <div className="overflow-hidden rounded-[20px] border border-border bg-card"><div className="hidden grid-cols-[1.2fr_1.3fr_.8fr_.8fr_1.3fr] gap-3 bg-secondary/60 px-5 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground sm:grid"><span>Order</span><span>Buyer delivery</span><span>Total</span><span>Status</span><span>Update</span></div>{active.recentOrders.map((order) => <div key={order.id} className="grid gap-3 border-t border-border px-4 py-4 sm:grid-cols-[1.2fr_1.3fr_.8fr_.8fr_1.3fr] sm:items-center sm:px-5" data-testid={`row-seller-order-${order.id}`}><div><p className="text-xs text-muted-foreground">Order</p><strong>{order.orderNumber}</strong></div><div className="text-sm">{order.deliveryAddress}</div><strong>{money(order.total)}</strong><span className="w-fit rounded-full bg-secondary px-3 py-1 text-xs font-bold" data-testid={`status-seller-order-${order.id}`}>{pretty(order.status)}</span><select value={order.status === 'pending_payment' || order.status === 'paid' ? 'processing' : order.status} onChange={(e) => status.mutate({ id: order.id, data: { status: e.target.value as 'processing' | 'in_transit' | 'delivered' | 'cancelled' } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetSellerDashboardQueryKey() }); client.invalidateQueries({ queryKey: getListOrdersQueryKey() }); } })} className="rounded-lg border border-input bg-background px-3 py-2 text-xs" aria-label={`Update order ${order.orderNumber}`} data-testid={`select-order-status-${order.id}`}><option value="processing">Processing</option><option value="in_transit">In transit</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select></div>)}</div>}
      </section>
      <section className="mt-10"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your catalogue</p><h2 className="serif mt-1 text-3xl">Inventory</h2></div><Link href="/seller/products/new" className="text-sm font-bold text-primary" data-testid="link-add-inventory">Add product +</Link></div>{products.isLoading ? <Skeleton className="h-24" /> : products.isError ? <Notice>Inventory could not be loaded. <button onClick={() => products.refetch()} className="underline" data-testid="button-retry-inventory">Retry</button></Notice> : products.data?.length ? <div className="overflow-hidden rounded-[20px] border border-border bg-card">{products.data.map((product) => <Link key={product.id} href={`/seller/products/${product.id}`} className="flex items-center gap-4 border-b border-border p-4 last:border-0 hover:bg-secondary/40" data-testid={`row-inventory-${product.id}`}><div className="size-14 overflow-hidden rounded-xl bg-secondary">{product.imageUrl && <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />}</div><div className="min-w-0 flex-1"><p className="font-bold">{product.name}</p><p className="text-xs text-muted-foreground">{money(product.price)} / {product.unit} · {product.location}</p></div><span className="text-sm font-semibold">{product.stock} {product.unit}</span><ArrowRight size={16} className="text-muted-foreground" /></Link>)}</div> : <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center"><p className="font-semibold">Your catalogue is waiting for its first listing.</p><Link href="/seller/products/new" className="mt-3 inline-flex text-sm font-bold text-primary" data-testid="link-first-listing">Create your first listing <ArrowRight size={14} className="ml-1" /></Link></div>}</section>
    </>}
    {status.isError && <div className="mt-4"><Notice>That fulfilment update did not save. Please try again.</Notice></div>}
  </main>;
}

function ProductEditor({ editing }: { editing: boolean }) {
  const params = useParams<{ id?: string }>();
  const id = Number(params.id);
  const productQuery = useGetProduct(editing ? id : 0, { query: { queryKey: getGetProductQueryKey(editing ? id : 0), enabled: editing && Number.isFinite(id) } });
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<ProductInput>({ name: '', description: '', category: 'produce', unit: 'kg', price: 0, minOrder: 1, stock: 0, imageUrl: '', location: '', farmName: '', wholesaleTiers: [] });
  const loadedId = useRef<number | null>(null);
  useEffect(() => {
    if (editing && productQuery.data && loadedId.current !== id) {
      const value = productQuery.data;
      loadedId.current = id;
      setForm({ name: value.name, description: value.description, category: value.category, unit: value.unit, price: value.price, minOrder: value.minOrder, stock: value.stock, imageUrl: value.imageUrl, location: value.location, farmName: value.farmName, wholesaleTiers: value.wholesaleTiers || [] });
    }
  }, [editing, id, productQuery.data]);
  const setField = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const tiers = form.wholesaleTiers || [];
  const updateTier = (index: number, change: Partial<ProductTier>) => setField('wholesaleTiers', tiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...change } : tier));
  const save = (e: FormEvent) => {
    e.preventDefault();
    const onSaved = () => { client.invalidateQueries({ queryKey: getListProductsQueryKey() }); if (editing) client.invalidateQueries({ queryKey: getGetProductQueryKey(id) }); setNotice('Listing saved.'); window.setTimeout(() => setLocation('/seller'), 550); };
    if (editing) update.mutate({ id, data: { ...form } }, { onSuccess: onSaved });
    else create.mutate({ data: { ...form } }, { onSuccess: onSaved });
  };
  if (editing && productQuery.isLoading) return <main className="shell py-12"><Skeleton className="h-[600px]" /></main>;
  if (editing && productQuery.isError) return <main className="shell py-12"><Notice>We couldn't load this product for editing. <Link href="/seller" className="underline" data-testid="link-back-seller">Back to seller workspace</Link></Notice></main>;
  return <main className="shell page-enter py-9 md:py-12"><Link href="/seller" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary" data-testid="link-back-seller-list"><ArrowLeft size={16} />Seller workspace</Link><PageTitle eyebrow="Seller catalogue" title={editing ? 'Edit your listing' : 'List something good'} description="Give buyers the details they need: the measure, the price and where it comes from." />
    <form onSubmit={save} className="grid gap-5 rounded-[24px] border border-border bg-card p-5 md:grid-cols-2 md:p-8">
      <Field label="Product name" value={form.name} onChange={(v) => setField('name', v)} required testId="input-product-name" placeholder="e.g. Fresh Roma tomatoes" />
      <label className="block"><span className="mb-2 block text-sm font-bold">Category</span><select value={form.category} onChange={(e) => setField('category', e.target.value as ProductCategory)} className="h-12 w-full rounded-xl border border-input bg-background px-3" data-testid="select-product-category">{categories.filter((c) => c.value !== 'all').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      <Field label="Price (₦)" value={String(form.price || '')} onChange={(v) => setField('price', Number(v))} type="number" min="1" required testId="input-product-price" />
      <label className="block"><span className="mb-2 block text-sm font-bold">Sold by</span><select value={form.unit} onChange={(e) => setField('unit', e.target.value as ProductUnit)} className="h-12 w-full rounded-xl border border-input bg-background px-3" data-testid="select-product-unit">{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
      <Field label="Minimum order" value={String(form.minOrder)} onChange={(v) => setField('minOrder', Number(v))} type="number" min="1" required testId="input-product-min-order" />
      <Field label="Available stock" value={String(form.stock)} onChange={(v) => setField('stock', Number(v))} type="number" min="0" required testId="input-product-stock" />
      <Field label="Farm / business name" value={form.farmName} onChange={(v) => setField('farmName', v)} required testId="input-product-farm" />
      <Field label="Location" value={form.location} onChange={(v) => setField('location', v)} required testId="input-product-location" placeholder="Town, State" />
      <div className="md:col-span-2"><Field label="Product image URL" value={form.imageUrl} onChange={(v) => setField('imageUrl', v)} testId="input-product-image" placeholder="https://..." /></div>
      <section className="rounded-2xl border border-border bg-[#f5f0e6]/70 p-4 md:col-span-2 md:p-5" aria-labelledby="wholesale-heading">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="wholesale-heading" className="font-bold">Wholesale price breaks</h2><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Optional. Set a minimum quantity and unit price for larger orders. Buyers will see each tier on your listing.</p></div><Button type="button" onClick={() => setField('wholesaleTiers', [...tiers, { minQuantity: Math.max(form.minOrder, 1), unitPrice: form.price || 1 }])} className="border border-border bg-card px-4 py-2.5 text-xs text-foreground hover:bg-secondary" data-testid="button-add-wholesale-tier"><Plus size={15} />Add price tier</Button></div>
        {tiers.length > 0 ? <div className="mt-4 space-y-2">{tiers.map((tier, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-xl bg-card p-3" data-testid={`row-wholesale-tier-${index}`}><Field label={`Minimum quantity (${form.unit})`} value={String(tier.minQuantity)} onChange={(v) => updateTier(index, { minQuantity: Number(v) })} type="number" min="1" required testId={`input-wholesale-quantity-${index}`} /><Field label={`Unit price (₦/${form.unit})`} value={String(tier.unitPrice)} onChange={(v) => updateTier(index, { unitPrice: Number(v) })} type="number" min="1" required testId={`input-wholesale-price-${index}`} /><button type="button" onClick={() => setField('wholesaleTiers', tiers.filter((_, tierIndex) => tierIndex !== index))} className="mb-1 grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-700" aria-label={`Remove wholesale tier ${index + 1}`} data-testid={`button-remove-wholesale-tier-${index}`}><X size={16} /></button></div>)}</div> : <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">No bulk pricing set. Your base price will apply to all orders.</p>}
      </section>
      <label className="block md:col-span-2"><span className="mb-2 block text-sm font-bold">Description</span><textarea rows={5} value={form.description} onChange={(e) => setField('description', e.target.value)} className="w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/30" placeholder="Tell buyers about quality, harvest or handling." data-testid="input-product-description" /></label>
      {notice && <div className="md:col-span-2"><Notice tone="success">{notice}</Notice></div>}
      {(create.isError || update.isError) && <div className="md:col-span-2"><Notice>We couldn't save this listing. Check the details and try again.</Notice></div>}
      <div className="flex flex-wrap gap-3 md:col-span-2"><Button type="submit" disabled={create.isPending || update.isPending} className="bg-primary text-primary-foreground hover:bg-[#214b37]" data-testid="button-save-product">{create.isPending || update.isPending ? 'Saving listing…' : editing ? 'Save changes' : 'Publish listing'} <ArrowRight size={16} /></Button><Link href="/seller" className="inline-flex items-center rounded-full border border-border px-5 py-3 text-sm font-semibold" data-testid="link-cancel-product">Cancel</Link></div>
    </form>
  </main>;
}
function Field({ label, value, onChange, testId, type = 'text', ...props }: { label: string; value: string; onChange: (value: string) => void; testId: string; type?: string; required?: boolean; min?: string; placeholder?: string }) {
  return <label className="block"><span className="mb-2 block text-sm font-bold">{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={props.required} min={props.min} placeholder={props.placeholder} className="h-12 w-full rounded-xl border border-input bg-background px-4 outline-none focus:ring-2 focus:ring-primary/30" data-testid={testId} /></label>;
}

function QuotationsPage() {
  const products = useListProducts();
  const quotes = useListQuotations({ query: { queryKey: getListQuotationsQueryKey(), retry: false } });
  const create = useCreateQuotation();
  const client = useQueryClient();
  const [businessName, setBusinessName] = useState('');
  const [notes, setNotes] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [lines, setLines] = useState<{ productId: number; quantity: number }[]>([]);
  const [sent, setSent] = useState(false);
  const addLine = () => { if (!productId || Number(quantity) < 1) return; const pid = Number(productId); setLines((prev) => [...prev.filter((line) => line.productId !== pid), { productId: pid, quantity: Number(quantity) }]); setProductId(''); setQuantity('1'); };
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { businessName, notes, items: lines } }, { onSuccess: () => { setSent(true); setLines([]); setBusinessName(''); setNotes(''); client.invalidateQueries({ queryKey: getListQuotationsQueryKey() }); } }); };
  const lineItems = lines.map((line) => ({ ...line, product: products.data?.find((p) => p.id === line.productId) }));
  return <main className="shell page-enter py-9 md:py-12"><PageTitle eyebrow="For kitchens, shops & makers" title="Buy in a bigger way." description="Tell suppliers what you need and request a quote for your business. No commitment until you agree to a quote." />
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_.85fr]"><form onSubmit={submit} className="space-y-5 rounded-[24px] border border-border bg-card p-5 md:p-7">
      <div className="flex items-center gap-3 rounded-xl bg-[#eee8da] p-4 text-sm"><Store size={20} className="text-primary" /><p>Build a list of products and quantities, then send a single request.</p></div>
      <Field label="Business name" value={businessName} onChange={setBusinessName} required testId="input-business-name" placeholder="Your kitchen, shop or company" />
      <div className="grid grid-cols-[1fr_90px_auto] items-end gap-2"><label className="block min-w-0"><span className="mb-2 block text-sm font-bold">Product</span><select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm" data-testid="select-quote-product"><option value="">Choose a listing</option>{products.data?.map((product) => <option key={product.id} value={product.id}>{product.name} · {money(product.price)}/{product.unit}</option>)}</select></label><Field label="Qty" value={quantity} onChange={setQuantity} type="number" min="1" testId="input-quote-quantity" /><Button type="button" onClick={addLine} className="h-12 bg-secondary px-4 text-secondary-foreground" data-testid="button-add-quote-item"><Plus size={17} />Add</Button></div>
      {lines.length > 0 && <div className="space-y-2 rounded-xl bg-secondary/40 p-3">{lineItems.map((line) => <div key={line.productId} className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm" data-testid={`row-quote-item-${line.productId}`}><span>{line.product?.name || `Product ${line.productId}`} <span className="text-muted-foreground">× {line.quantity}</span></span><button type="button" onClick={() => setLines((prev) => prev.filter((item) => item.productId !== line.productId))} className="p-1 text-muted-foreground hover:text-red-700" aria-label="Remove quote line" data-testid={`button-remove-quote-item-${line.productId}`}><X size={15} /></button></div>)}</div>}
      <label className="block"><span className="mb-2 block text-sm font-bold">Notes for suppliers <span className="font-normal text-muted-foreground">(optional)</span></span><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery timing, preferred grade, or anything else to know." className="w-full rounded-xl border border-input bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/30" data-testid="input-quotation-notes" /></label>
      {sent && <Notice tone="success">Your quote request is in. Suppliers will review the quantities.</Notice>}
      {create.isError && <Notice>Your quote request could not be sent. Please try again.</Notice>}
      {products.isError && <Notice>Products could not load. Please refresh and try again.</Notice>}
      <Button type="submit" disabled={create.isPending || !businessName.trim() || lines.length === 0} className="w-full bg-primary text-primary-foreground hover:bg-[#214b37]" data-testid="button-submit-quotation">{create.isPending ? 'Sending request…' : 'Send quote request'} <ArrowRight size={16} /></Button>
    </form>
    <section><div className="mb-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your requests</p><h2 className="serif mt-1 text-3xl">Quote history</h2></div>{quotes.isLoading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : quotes.isError ? <Notice>Sign in to view your quotation requests. <Link href="/sign-in" className="font-bold underline" data-testid="link-quote-sign-in">Sign in</Link></Notice> : !quotes.data?.length ? <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">Your requests and supplier responses will appear here.</div> : <div className="space-y-3">{quotes.data.map((quote) => <article key={quote.id} className="rounded-2xl border border-border bg-card p-4" data-testid={`card-quotation-${quote.id}`}><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{quote.businessName}</h3><p className="mt-1 text-xs text-muted-foreground">{new Date(quote.createdAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</p></div><span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold" data-testid={`status-quotation-${quote.id}`}>{pretty(quote.status)}</span></div><p className="mt-3 text-sm">{quote.items.map((item) => `${item.quantity} × ${item.name}`).join(' · ')}</p>{quote.notes && <p className="mt-2 text-xs text-muted-foreground">{quote.notes}</p>}</article>)}</div>}</section></div>
  </main>;
}

function AccountRolePage() {
  const account = useGetAccount({ query: { queryKey: getGetAccountQueryKey(), retry: false } });
  const requestRole = useRequestAccountRole();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<'farmer' | 'supplier' | 'business_buyer'>('farmer');
  const [businessName, setBusinessName] = useState('');
  const [location, setAccountLocation] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    requestRole.mutate({ data: { role, ...(businessName.trim() ? { businessName: businessName.trim() } : {}), ...(location.trim() ? { location: location.trim() } : {}) } }, {
      onSuccess: (updated) => {
        client.setQueryData(getGetAccountQueryKey(), updated);
        client.invalidateQueries({ queryKey: getGetAccountQueryKey() });
        setLocation(role === 'business_buyer' ? '/business/quotations' : '/seller');
      },
    });
  };
  const currentRoles = account.data?.roles?.filter((value) => value !== 'consumer') || [];
  return <main className="shell page-enter py-9 md:py-12"><PageTitle eyebrow="Set up your market account" title="How do you use AgroMarket?" description="Choose the account type that best fits. You can shop locally as a consumer without selecting a seller or business role." />
    <div className="grid gap-8 lg:grid-cols-[1.05fr_.8fr]">
      <form onSubmit={submit} className="space-y-5 rounded-[24px] border border-border bg-card p-5 md:p-7">
        {account.isLoading ? <Skeleton className="h-12" /> : account.isError ? <Notice>Sign in to set up your account type. <Link href="/sign-in" className="font-bold underline" data-testid="link-role-sign-in">Sign in</Link></Notice> : <>
          {currentRoles.length > 0 && <div className="rounded-xl bg-[#e8f0e2] p-4 text-sm text-primary" data-testid="text-current-account-roles"><strong>Current roles:</strong> {currentRoles.map(pretty).join(', ')}</div>}
          <fieldset className="space-y-3"><legend className="mb-3 text-sm font-bold">Choose a role</legend>
            {[
              ['farmer', 'I grow food', 'List harvests and manage farm orders.'],
              ['supplier', 'I supply farm goods', 'Offer foodstuff, inputs or equipment to buyers.'],
              ['business_buyer', 'I buy for a business', 'Request bulk quotes for a kitchen, shop or company.'],
            ].map(([value, title, description]) => <label key={value} className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors ${role === value ? 'border-primary bg-[#edf3e8]' : 'border-border hover:bg-secondary/50'}`}><input type="radio" name="account-role" value={value} checked={role === value} onChange={() => setRole(value as typeof role)} className="mt-1 accent-[#285b42]" data-testid={`input-account-role-${value}`} /><span><span className="block font-bold">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span></label>)}
          </fieldset>
          {role !== 'farmer' && <Field label={role === 'business_buyer' ? 'Business name' : 'Supplier / business name'} value={businessName} onChange={setBusinessName} testId="input-account-business-name" placeholder="Name shown to buyers or suppliers" />}
          <Field label="Location" value={location} onChange={setAccountLocation} testId="input-account-location" placeholder="Town, State" />
          <p className="text-xs leading-5 text-muted-foreground">Admin access is never self-selected. It is reserved for accounts granted admin access by the platform.</p>
          {requestRole.isError && <Notice>Your account type could not be saved. Please sign in and try again.</Notice>}
          <Button type="submit" disabled={requestRole.isPending || account.isError} className="w-full bg-primary text-primary-foreground hover:bg-[#214b37]" data-testid="button-request-account-role">{requestRole.isPending ? 'Saving account type…' : 'Save account type'} <ArrowRight size={16} /></Button>
        </>}
      </form>
      <aside className="rounded-[24px] bg-[#214b37] p-6 text-[#f8f5eb] md:p-8"><span className="grid size-11 place-items-center rounded-2xl bg-[#f8f5eb]/10"><Sprout size={23} /></span><h2 className="serif mt-5 text-3xl">One market, many ways in.</h2><p className="mt-3 text-sm leading-6 text-[#d5e0d1]">Farmers and suppliers keep their listings and fulfilment in view. Business buyers can gather quantities into a single quote request. Everyone can shop the market.</p><div className="mt-6 border-t border-[#f8f5eb]/20 pt-5 text-xs leading-5 text-[#d5e0d1]">Your account role helps shape your workspace. Verification and access are managed separately by the platform.</div></aside>
    </div>
  </main>;
}

function AdminDashboardPage() {
  const account = useGetAccount({ query: { queryKey: getGetAccountQueryKey(), retry: false } });
  const isAdmin = account.data?.roles?.includes('admin') ?? false;
  const dashboard = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey(), enabled: isAdmin, retry: false } });
  const verifications = useListSellerVerifications({ query: { queryKey: getListSellerVerificationsQueryKey(), enabled: isAdmin, retry: false } });
  const update = useUpdateSellerVerification();
  const client = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const review = (id: number, status: 'approved' | 'rejected') => update.mutate({ id, data: { status } }, {
    onSuccess: () => {
      setFeedback(`Verification ${status}.`);
      client.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
      client.invalidateQueries({ queryKey: getListSellerVerificationsQueryKey() });
    },
  });
  if (account.isLoading) return <main className="shell py-12"><Skeleton className="h-40" /></main>;
  if (account.isError) return <main className="shell page-enter py-12"><PageTitle eyebrow="Platform operations" title="Admin verification" /><Notice>Sign in with an authorized admin account to access verification review. <Link href="/sign-in" className="font-bold underline" data-testid="link-admin-sign-in">Sign in</Link></Notice></main>;
  if (!isAdmin) return <main className="shell page-enter py-12"><PageTitle eyebrow="Platform operations" title="Admin verification" description="This workspace is restricted to platform admin accounts." /><div className="max-w-xl"><Notice tone="info">Your account does not have admin access. Admin access cannot be selected from account setup. <Link href="/account/role" className="ml-1 font-bold underline" data-testid="link-role-setup-from-admin">Review account setup</Link></Notice></div></main>;
  const metrics = dashboard.data ? [
    ['Pending verifications', dashboard.data.pendingVerifications, <ShieldCheck size={18} />],
    ['Active listings', dashboard.data.activeListings, <Box size={18} />],
    ['Flagged payments', dashboard.data.flaggedPayments, <CircleHelp size={18} />],
    ['Open disputes', dashboard.data.openDisputes, <Clock3 size={18} />],
    ['Gross merchandise value', money(dashboard.data.grossMerchandiseValueNgn), <ArrowDown size={18} />],
  ] : [];
  return <main className="shell page-enter py-9 md:py-12"><PageTitle eyebrow="Platform operations" title="Verification desk" description="Review seller applications and keep trust signals current across the marketplace." />
    {dashboard.isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}</div> : dashboard.isError ? <Notice>Admin dashboard metrics could not be loaded. Please retry.</Notice> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{metrics.map(([label, value, icon]) => <div key={String(label)} className="rounded-[20px] border border-border bg-card p-4" data-testid={`metric-admin-${String(label).toLowerCase().replaceAll(' ', '-')}`}><span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary">{icon}</span><p className="mt-3 text-xs font-semibold text-muted-foreground">{label}</p><p className="serif mt-1 text-2xl">{value}</p></div>)}</div>}
    <section className="mt-10"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Trust & safety</p><h2 className="serif mt-1 text-3xl">Seller verification requests</h2></div><span className="text-xs text-muted-foreground">{verifications.data?.filter((entry) => entry.status === 'pending').length ?? 0} awaiting review</span></div>
      {feedback && <div className="mb-4"><Notice tone="success">{feedback}</Notice></div>}
      {update.isError && <div className="mb-4"><Notice>That decision could not be saved. Please try again.</Notice></div>}
      {verifications.isLoading ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : verifications.isError ? <Notice>Verification requests could not be loaded. Refresh to try again.</Notice> : !verifications.data?.length ? <div className="rounded-2xl border border-dashed border-border bg-card p-9 text-center"><BadgeCheck size={28} className="mx-auto text-primary" /><p className="mt-3 font-semibold">No verification requests to review.</p></div> : <div className="space-y-3">{verifications.data.map((entry) => <article key={entry.id} className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-5 sm:flex-row sm:items-center" data-testid={`card-verification-${entry.id}`}><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-secondary text-primary"><Store size={21} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{entry.businessName}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${entry.status === 'pending' ? 'bg-[#fff0d6] text-[#785728]' : entry.status === 'approved' ? 'bg-[#e3efdf] text-primary' : 'bg-red-50 text-red-800'}`} data-testid={`status-verification-${entry.id}`}>{pretty(entry.status)}</span></div><p className="mt-1 text-sm text-muted-foreground">{entry.sellerName} · {entry.location}</p><p className="mt-1 text-xs text-muted-foreground">Submitted {new Date(entry.submittedAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })} · Seller reference {entry.sellerId}</p></div>{entry.status === 'pending' && <div className="flex gap-2"><Button onClick={() => review(entry.id, 'approved')} disabled={update.isPending} className="bg-primary px-4 py-2.5 text-xs text-primary-foreground" data-testid={`button-approve-verification-${entry.id}`}><Check size={15} />Approve</Button><Button onClick={() => review(entry.id, 'rejected')} disabled={update.isPending} className="border border-border bg-background px-4 py-2.5 text-xs text-foreground" data-testid={`button-reject-verification-${entry.id}`}>Reject</Button></div>}</article>)}</div>}
    </section>
  </main>;
}

function SignInPage() {
  return <main className="grain flex min-h-[calc(100dvh-72px)] items-center justify-center bg-[#eae7d9] px-4 py-10"><div className="w-full max-w-[470px]"><p className="mb-6 text-center text-xs font-bold uppercase tracking-[.18em] text-primary">Your local market, in one place</p><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></main>;
}
function SignUpPage() {
  return <main className="grain flex min-h-[calc(100dvh-72px)] items-center justify-center bg-[#eae7d9] px-4 py-10"><div className="w-full max-w-[470px]"><p className="mb-6 text-center text-xs font-bold uppercase tracking-[.18em] text-primary">Join the AgroMarket community</p><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></main>;
}
function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/orders" /></Show><Show when="signed-out"><Storefront /></Show></>;
}
function LogoutButton() {
  const { signOut } = useClerk();
  return <button type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="text-sm font-semibold text-primary" data-testid="button-sign-out">Sign out</button>;
}
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previous.current !== undefined && previous.current !== userId) client.clear();
      previous.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}
function AccountControls() {
  const { isSignedIn, user } = useUser();
  const account = useGetAccount({ query: { enabled: !!isSignedIn, queryKey: getGetAccountQueryKey(), retry: false } });
  if (!isSignedIn) return null;
  return <div className="hidden items-center justify-end gap-3 border-b border-border bg-card/70 px-5 py-2 lg:flex"><span className="max-w-36 truncate text-xs font-semibold text-muted-foreground">{user?.firstName || user?.primaryEmailAddress?.emailAddress}</span>{account.data?.roles.includes('admin') && <Link href="/admin" className="text-sm font-semibold text-primary" data-testid="link-admin-dashboard">Admin desk</Link>}<LogoutButton /></div>;
}
function AppFrame({ children }: { children: ReactNode }) {
  return <><Header /><AccountControls />{children}<Footer /></>;
}
function AppRoutes() {
  return <Switch>
    <Route path="/" component={() => <AppFrame><HomeRedirect /></AppFrame>} />
    <Route path="/products/:id" component={() => <AppFrame><ProductDetails /></AppFrame>} />
    <Route path="/cart" component={() => <AppFrame><CartPage /></AppFrame>} />
    <Route path="/checkout" component={() => <AppFrame><CheckoutPage /></AppFrame>} />
    <Route path="/orders" component={() => <AppFrame><OrdersPage /></AppFrame>} />
    <Route path="/seller" component={() => <AppFrame><SellerDashboard /></AppFrame>} />
    <Route path="/seller/products/new" component={() => <AppFrame><ProductEditor editing={false} /></AppFrame>} />
    <Route path="/seller/products/:id" component={() => <AppFrame><ProductEditor editing /></AppFrame>} />
    <Route path="/business/quotations" component={() => <AppFrame><QuotationsPage /></AppFrame>} />
    <Route path="/account/role" component={() => <AppFrame><AccountRolePage /></AppFrame>} />
    <Route path="/admin" component={() => <AppFrame><AdminDashboardPage /></AppFrame>} />
    <Route path="/sign-in/*?" component={() => <AppFrame><SignInPage /></AppFrame>} />
    <Route path="/sign-up/*?" component={() => <AppFrame><SignUpPage /></AppFrame>} />
    <Route component={NotFound} />
  </Switch>;
}
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your AgroMarket account' } }, signUp: { start: { title: 'Join AgroMarket', subtitle: 'Buy local. Grow together.' } } }}
    routerPush={(to: string) => setLocation(stripBase(to))} routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><AppRoutes /></QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}

export default App;
