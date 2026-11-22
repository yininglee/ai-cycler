"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { scopedBrowserKey } from "../../src/auth/browser-scope";
import { createClientRequestId } from "../../src/ui/client-request-id";

const AccountScope = createContext<string | undefined>(undefined);
const SESSION_CHANGED_KEY = "cycler-account-session-changed";

export function notifyAccountChange() {
  try { localStorage.setItem(SESSION_CHANGED_KEY, createClientRequestId()); } catch {}
}

export function AccountScopeProvider({ scope, children }: { scope?: string; children: ReactNode }) {
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === SESSION_CHANGED_KEY) window.location.reload();
    }
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return <AccountScope.Provider value={scope}>{children}</AccountScope.Provider>;
}

export function useAccountStorage() {
  const scope = useContext(AccountScope);
  const sessionData = useMemo(() => ({
    getItem: (key: string) => sessionStorage.getItem(scopedBrowserKey(key, scope)),
    setItem: (key: string, value: string) => sessionStorage.setItem(scopedBrowserKey(key, scope), value),
    removeItem: (key: string) => sessionStorage.removeItem(scopedBrowserKey(key, scope)),
  }), [scope]);
  return { scope, sessionData };
}
