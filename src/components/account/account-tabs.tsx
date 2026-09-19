"use client";

import { ResendVerificationButton } from "@/components/account/resend-verification-button";
import { Button, buttonClassNames } from "@/components/ui/button";
import { useWishlist } from "@/context/wishlist-provider";
import { INDIAN_PHONE_HINT, INDIAN_PINCODE_HINT, normalizeIndianPhone, normalizeIndianPincode } from "@/lib/validation/india";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface CustomerInfo {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  emailVerified: boolean;
}

interface AddressInfo {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

interface ReviewInfo {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  createdAt: string;
  productName: string;
  productSlug: string;
}

const TABS = ["Orders", "Addresses", "Reviews", "Wishlist", "Profile"] as const;
type Tab = (typeof TABS)[number];

export function AccountTabs({
  customer,
  initialAddresses,
  initialReviews,
}: {
  customer: CustomerInfo;
  initialAddresses: AddressInfo[];
  initialReviews: ReviewInfo[];
}) {
  const [tab, setTab] = useState<Tab>("Orders");

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              tab === item ? "bg-brand text-white" : "text-ink hover:bg-lilac/40",
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {tab === "Orders" && <OrdersTab />}
        {tab === "Addresses" && <AddressesTab initialAddresses={initialAddresses} />}
        {tab === "Reviews" && <ReviewsTab reviews={initialReviews} />}
        {tab === "Wishlist" && <WishlistTab />}
        {tab === "Profile" && <ProfileTab customer={customer} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders (empty state only — order history read API is D4/D3 territory)
// ---------------------------------------------------------------------------

function OrdersTab() {
  return (
    <EmptyState
      title="No Orders Yet"
      description="Once you place an order, it will show up here with its status and tracking details."
      actionHref="/shop"
      actionLabel="Start Shopping"
    />
  );
}

// ---------------------------------------------------------------------------
// Addresses (full CRUD)
// ---------------------------------------------------------------------------

function AddressesTab({ initialAddresses }: { initialAddresses: AddressInfo[] }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [editing, setEditing] = useState<AddressInfo | "new" | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    const response = await fetch("/api/account/addresses");
    if (response.ok) {
      const data = await response.json();
      setAddresses(data.addresses);
    }
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this address?")) return;
    const response = await fetch(`/api/account/addresses/${id}`, { method: "DELETE" });
    if (response.ok) {
      setAddresses((current) => current.filter((address) => address.id !== id));
      router.refresh();
    } else {
      setError("Could not delete this address.");
    }
  };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {addresses.map((address) => (
          <div key={address.id} className="rounded-2xl border border-border p-5">
            {address.isDefault && (
              <span className="mb-2 inline-block rounded-full bg-brand/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
                Default
              </span>
            )}
            {address.label && <p className="text-sm font-semibold text-ink">{address.label}</p>}
            <p className="text-sm text-muted">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ""}
              <br />
              {address.city}, {address.state} {address.postalCode}
              <br />
              {address.country}
              {address.phone ? ` · ${address.phone}` : ""}
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setEditing(address)}
                className="text-sm font-semibold text-brand hover:underline"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(address.id)}
                className="text-sm font-semibold text-red-600 hover:underline"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {addresses.length === 0 && (
          <p className="text-sm text-muted">You haven&apos;t saved any addresses yet.</p>
        )}
      </div>

      {editing ? (
        <AddressForm
          address={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : (
        <Button onClick={() => setEditing("new")}>Add New Address</Button>
      )}
    </div>
  );
}

function AddressForm({
  address,
  onCancel,
  onSaved,
}: {
  address: AddressInfo | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setFieldErrors({});

    const form = new FormData(formElement);
    const rawPhone = ((form.get("phone") as string) || "").trim();
    const rawPostalCode = ((form.get("postalCode") as string) || "").trim();

    // Client-side format check first (same rule as the server —
    // src/lib/validation/schemas.ts — which is authoritative and re-checks
    // regardless, since this can always be bypassed by calling the API
    // directly). Phone is optional on a saved address; postal code isn't.
    const normalizedPhone = rawPhone ? normalizeIndianPhone(rawPhone) : null;
    const normalizedPostalCode = normalizeIndianPincode(rawPostalCode);
    const nextFieldErrors: Record<string, string> = {};
    if (rawPhone && !normalizedPhone) nextFieldErrors.phone = INDIAN_PHONE_HINT;
    if (!normalizedPostalCode) nextFieldErrors.postalCode = INDIAN_PINCODE_HINT;
    if (Object.keys(nextFieldErrors).length > 0) {
      setStatus("error");
      setFieldErrors(nextFieldErrors);
      setError("Please fix the highlighted field(s) below.");
      return;
    }

    setStatus("loading");

    const payload = {
      label: form.get("label") || undefined,
      line1: form.get("line1"),
      line2: form.get("line2") || undefined,
      city: form.get("city"),
      state: form.get("state"),
      postalCode: normalizedPostalCode,
      country: (form.get("country") as string) || "IN",
      phone: normalizedPhone ?? undefined,
      isDefault: form.get("isDefault") === "on",
    };

    try {
      const response = await fetch(
        address ? `/api/account/addresses/${address.id}` : "/api/account/addresses",
        {
          method: address ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setStatus("error");
        setError(data?.error ?? "Could not save this address.");
        const details = data?.details?.fieldErrors as Record<string, string[]> | undefined;
        if (details) {
          const flattened: Record<string, string> = {};
          for (const [key, messages] of Object.entries(details)) {
            if (messages?.[0]) flattened[key] = messages[0];
          }
          setFieldErrors(flattened);
        }
        return;
      }
      onSaved();
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Label" name="label" defaultValue={address?.label ?? ""} />
        <TextField label="Phone" name="phone" defaultValue={address?.phone ?? ""} error={fieldErrors.phone} />
      </div>
      <TextField label="Address Line 1 *" name="line1" required defaultValue={address?.line1 ?? ""} />
      <TextField label="Address Line 2" name="line2" defaultValue={address?.line2 ?? ""} />
      <div className="grid gap-4 md:grid-cols-3">
        <TextField label="City *" name="city" required defaultValue={address?.city ?? ""} />
        <TextField label="State *" name="state" required defaultValue={address?.state ?? ""} />
        <TextField
          label="Postal Code *"
          name="postalCode"
          required
          defaultValue={address?.postalCode ?? ""}
          error={fieldErrors.postalCode}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={address?.isDefault}
          className="h-4 w-4 rounded border-border text-brand"
        />
        Set as default address
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Saving..." : "Save Address"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TextField({
  label,
  name,
  required,
  defaultValue,
  error,
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-2 block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className={cn(
          "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/20",
          error ? "border-red-400 focus:border-red-500" : "border-border focus:border-brand",
        )}
      />
      {error && (
        <p id={`${name}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews (read-only list across all statuses; submission is D2)
// ---------------------------------------------------------------------------

function ReviewsTab({ reviews }: { reviews: ReviewInfo[] }) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        title="No Reviews Yet"
        description="Reviews you write on products you've bought will show up here, including ones still awaiting moderation."
        actionHref="/shop"
        actionLabel="Browse Products"
      />
    );
  }

  return (
    <div className="space-y-4">
      {reviews.map((review) => (
        <div key={review.id} className="rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between">
            <Link href={`/products/${review.productSlug}`} className="font-semibold text-ink hover:text-brand">
              {review.productName}
            </Link>
            <StatusBadge status={review.status} />
          </div>
          <p className="mt-1 text-sm text-muted">Rating: {review.rating} / 5</p>
          {review.title && <p className="mt-2 font-semibold text-ink">{review.title}</p>}
          <p className="mt-1 text-sm text-muted">{review.body}</p>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800",
    APPROVED: "bg-trust/15 text-trust",
    REJECTED: "bg-red-100 text-red-700",
  };
  return (
    <span className={cn("rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide", styles[status])}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Wishlist (local-storage only for now — see D1 report for the deferred
// server-side merge on login)
// ---------------------------------------------------------------------------

function WishlistTab() {
  const { items } = useWishlist();

  if (items.length === 0) {
    return (
      <EmptyState
        title="Your Wishlist Is Empty"
        description="Save products you like and they'll show up here on this device."
        actionHref="/shop"
        actionLabel="Browse Products"
      />
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Saved on this device. Syncing your wishlist to your account is coming soon.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/products/${item.handle}`}
            className="rounded-2xl border border-border p-4 hover:border-brand"
          >
            <p className="font-semibold text-ink">{item.name}</p>
            <p className="text-sm text-muted">₹{item.price}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileTab({ customer }: { customer: CustomerInfo }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "saved">("idle");
  const [error, setError] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "loading" | "error" | "saved">("idle");
  const [passwordError, setPasswordError] = useState("");

  const handleProfileSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus("loading");
    setError("");

    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          phone: form.get("phone") || undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setStatus("error");
        setError(data?.error ?? "Could not update your profile.");
        return;
      }
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPasswordStatus("loading");
    setPasswordError("");

    const form = new FormData(formElement);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      setPasswordStatus("error");
      setPasswordError("New passwords do not match.");
      return;
    }

    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          newPassword,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setPasswordStatus("error");
        setPasswordError(data?.error ?? "Could not update your password.");
        return;
      }
      setPasswordStatus("saved");
      formElement.reset();
    } catch {
      setPasswordStatus("error");
      setPasswordError("Something went wrong. Please try again.");
    }
  };

  return (
    <div className="space-y-10">
      <form onSubmit={handleProfileSubmit} className="max-w-md space-y-4 rounded-2xl border border-border p-6">
        <h3 className="font-display text-lg font-bold text-ink">Profile Details</h3>
        <p className="text-sm text-muted">
          {customer.email} {customer.emailVerified ? "· Verified" : "· Not yet verified"}
        </p>
        {!customer.emailVerified && (
          <ResendVerificationButton email={customer.email} className="-mt-2" />
        )}
        <TextField label="Full Name *" name="name" required defaultValue={customer.name} />
        <TextField label="Phone" name="phone" defaultValue={customer.phone ?? ""} />
        {status === "error" && <p className="text-sm text-red-600">{error}</p>}
        {status === "saved" && <p className="text-sm text-trust">Profile updated.</p>}
        <Button type="submit" disabled={status === "loading"}>
          {status === "loading" ? "Saving..." : "Save Changes"}
        </Button>
      </form>

      <form onSubmit={handlePasswordSubmit} className="max-w-md space-y-4 rounded-2xl border border-border p-6">
        <h3 className="font-display text-lg font-bold text-ink">Change Password</h3>
        <div>
          <label htmlFor="currentPassword" className="mb-2 block text-sm font-semibold text-ink">
            Current Password *
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div>
          <label htmlFor="newPassword" className="mb-2 block text-sm font-semibold text-ink">
            New Password *
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-ink">
            Confirm New Password *
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        {passwordStatus === "error" && <p className="text-sm text-red-600">{passwordError}</p>}
        {passwordStatus === "saved" && <p className="text-sm text-trust">Password updated.</p>}
        <Button type="submit" disabled={passwordStatus === "loading"}>
          {passwordStatus === "loading" ? "Updating..." : "Update Password"}
        </Button>
      </form>

      <LogoutButton />
    </div>
  );
}

function LogoutButton() {
  const router = useRouter();
  const handleLogout = async () => {
    await fetch("/api/account/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };
  return (
    <Button variant="outline" onClick={handleLogout}>
      Sign Out
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>
      <Link href={actionHref} className={buttonClassNames({ className: "mt-4" })}>
        {actionLabel}
      </Link>
    </div>
  );
}
