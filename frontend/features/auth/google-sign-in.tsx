"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

import { useAuth } from "@/features/auth/auth-provider";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: { client_id: string; callback: (response: { credential?: string }) => void }): void;
          renderButton(element: HTMLElement, options: { theme: "outline"; size: "large"; text: "continue_with"; width: number }): void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export function GoogleSignIn() {
  const { loginWithGoogle } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !scriptReady || !containerRef.current || !window.google) return;
    const container = containerRef.current;
    container.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (!response.credential) {
          setError("Google did not return a sign-in credential.");
          return;
        }
        setSigningIn(true);
        setError(null);
        void loginWithGoogle(response.credential)
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Google sign-in failed. Please try again."))
          .finally(() => setSigningIn(false));
      },
    });
    window.google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      width: Math.max(220, Math.min(360, Math.floor(container.clientWidth || 300))),
    });
  }, [loginWithGoogle, scriptReady]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="space-y-2">
      <div className="relative py-1 text-center text-xs text-muted-foreground">
        <span className="bg-card px-2">or continue with</span>
      </div>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setError("Google sign-in could not load. Check your connection and try again.")}
      />
      <div ref={containerRef} aria-busy={signingIn} className={signingIn ? "pointer-events-none opacity-50" : undefined} />
      {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}
    </div>
  );
}
