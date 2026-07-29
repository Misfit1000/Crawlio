import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface AppLocation {
  pathname: string;
  search: string;
  hash: string;
}

type NavigateOptions = { replace?: boolean };
type Navigate = (to: string, options?: NavigateOptions) => void;

const RouterContext = createContext<{ location: AppLocation; navigate: Navigate } | null>(null);

function currentLocation(): AppLocation {
  return { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash };
}

function sameOriginUrl(to: string) {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) throw new Error('Navigation target must be on the Crawlio origin.');
  return url;
}

export function BrowserRouter({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<AppLocation>(() => currentLocation());
  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  const navigate = useCallback<Navigate>((to, options = {}) => {
    const url = sameOriginUrl(to);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (options.replace) window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
    setLocation(currentLocation());
    if (url.hash) window.setTimeout(() => document.getElementById(url.hash.slice(1))?.scrollIntoView({ block: 'start' }), 0);
    else window.scrollTo({ top: 0, left: 0 });
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const value = useContext(RouterContext);
  if (!value) throw new Error('Router hooks must be used inside BrowserRouter.');
  return value;
}

export function useLocation() {
  return useRouter().location;
}

export function useNavigate() {
  return useRouter().navigate;
}

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, target, ...props }: LinkProps) {
  const navigate = useNavigate();
  return <a {...props} href={to} target={target} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }} />;
}

type NavLinkProps = Omit<LinkProps, 'className'> & {
  className?: string | ((state: { isActive: boolean }) => string);
  end?: boolean;
};

export function NavLink({ className, end = false, to, ...props }: NavLinkProps) {
  const location = useLocation();
  const targetPath = sameOriginUrl(to).pathname.replace(/\/$/, '') || '/';
  const currentPath = location.pathname.replace(/\/$/, '') || '/';
  const isActive = end ? currentPath === targetPath : currentPath === targetPath || (targetPath !== '/' && currentPath.startsWith(`${targetPath}/`));
  return <Link {...props} to={to} className={typeof className === 'function' ? className({ isActive }) : className} />;
}
