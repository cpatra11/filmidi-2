import { useState, useRef, useEffect } from "react";
import {
  User,
  Settings,
  CreditCard,
  LogOut,
  LogIn,
  ExternalLink,
} from "lucide-react";
import { useAccountStore } from "@/store/useAccountStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { cn } from "@/lib/utils";

function UserAvatar({
  name,
  avatarUrl,
  size = "md",
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "w-6 h-6 text-[10px]",
    md: "w-8 h-8 text-xs",
    lg: "w-12 h-12 text-sm",
  };

  const initial = name ? name.charAt(0).toUpperCase() : null;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name || "User"}
        className={cn(sizeClasses[size], "rounded-full object-cover")}
      />
    );
  }

  if (initial) {
    return (
      <div
        className={cn(
          sizeClasses[size],
          "rounded-full bg-gradient-to-br from-white to-white/80 flex items-center justify-center font-medium text-white"
        )}
      >
        {initial}
      </div>
    );
  }

  return (
    <div
      className={cn(
        sizeClasses[size],
        "rounded-full bg-white/10 flex items-center justify-center"
      )}
    >
      <User size={size === "sm" ? 12 : size === "md" ? 14 : 18} className="text-white/50" />
    </div>
  );
}

export function AccountPopover() {
  const { email, name, avatarUrl, plan, creditsRemaining, isSignedIn, signOut } =
    useAccountStore();
  const { open: openSettings } = useSettingsStore();
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const signedIn = isSignedIn();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={popoverRef}>
      {/* Avatar button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="electrobun-webkit-app-region-no-drag"
      >
        <UserAvatar name={name} avatarUrl={avatarUrl} size="md" />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-[280px] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          {/* Identity block */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <UserAvatar name={name} avatarUrl={avatarUrl} size="lg" />
              <div className="min-w-0">
                {signedIn ? (
                  <>
                    <div className="text-sm font-medium truncate">
                      {name || "User"}
                    </div>
                    <div className="text-xs text-white/50 truncate">{email}</div>
                  </>
                ) : (
                  <div className="text-sm text-white/50">Not signed in</div>
                )}
              </div>
            </div>
          </div>

          {/* Plan & Credits */}
          {signedIn && (
            <div className="p-4 border-b border-white/10 space-y-3">
              {/* Plan */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">Plan</span>
                <span
                  className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    plan === "max"
                      ? "bg-amber-500/20 text-amber-300"
                      : plan === "pro"
                        ? "bg-white/10 text-white/60"
                        : "bg-white/10 text-white/60"
                  )}
                >
                  {plan === "max" ? "Max" : plan === "pro" ? "Pro" : "Free"}
                </span>
              </div>

              {/* Credits */}
              {creditsRemaining !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/50">Credits</span>
                  <div className="flex items-center gap-1.5">
                    <CreditCard
                      size={12}
                      className={cn(
                        creditsRemaining < 5
                          ? "text-red-400"
                          : creditsRemaining < 20
                            ? "text-amber-400"
                            : "text-green-400"
                      )}
                    />
                    <span className="text-sm font-medium">
                      {creditsRemaining}
                    </span>
                  </div>
                </div>
              )}

              {/* Upgrade button */}
              {plan !== "max" && (
                <button className="w-full py-2 text-xs font-medium bg-gradient-to-r bg-white text-black hover:bg-white/90 rounded-lg transition-colors">
                  Upgrade to {plan === "pro" ? "Max" : "Pro"}
                </button>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="p-2">
            {signedIn ? (
              <>
                <button
                  onClick={() => {
                    openSettings();
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-colors"
                >
                  <Settings size={14} />
                  Settings
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-colors"
                >
                  <ExternalLink size={14} />
                  Manage Subscription
                </button>
                <div className="h-px bg-white/10 my-1" />
                <button
                  onClick={() => {
                    signOut();
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg transition-colors"
                >
                  <LogOut size={14} />
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-colors"
                  onClick={() => {
                    openSettings();
                    setIsOpen(false);
                  }}
                >
                  <Settings size={14} />
                  Settings
                </button>
                <div className="h-px bg-white/10 my-1" />
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white/80 rounded-lg transition-colors"
                  onClick={() => {
                    openSettings();
                    setIsOpen(false);
                  }}
                >
                  <LogIn size={14} />
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { UserAvatar };
