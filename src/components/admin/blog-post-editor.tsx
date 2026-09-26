"use client";

import { Button } from "@/components/ui/button";
import { formatIstDateOnly } from "@/lib/format/datetime";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function BlogPostEditor({
  initial,
}: {
  initial?: {
    id?: string;
    slug: string;
    title: string;
    excerpt: string;
    category: string;
    author: string;
    publishedAt: string;
    readTime: string;
    image: string;
    content: string[];
    status: "DRAFT" | "PUBLISHED";
  };
}) {
  const router = useRouter();
  const [form, setForm] = useState(
    initial ?? {
      slug: "",
      title: "",
      excerpt: "",
      category: "Guide",
      author: "DAAKYKA Editorial",
      // F-331: `new Date().toISOString().slice(0, 10)` (the old default)
      // reads the UTC calendar date — after IST midnight but before UTC
      // midnight (00:00-05:29 IST) it defaulted to yesterday.
      publishedAt: formatIstDateOnly(),
      readTime: "5 min read",
      image: "",
      content: [""],
      status: "DRAFT" as const,
    },
  );
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  const save = async () => {
    setStatus("saving");
    const payload = {
      ...form,
      content: form.content.filter(Boolean),
    };

    const response = await fetch(
      initial?.id ? `/api/admin/blog/${initial.id}` : "/api/admin/blog",
      {
        method: initial?.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      setStatus("error");
      return;
    }

    router.push("/admin/blog");
    router.refresh();
  };

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-surface p-6">
      {(
        [
          ["title", "Title", "text"],
          ["slug", "Slug", "text"],
          ["excerpt", "Excerpt", "text"],
          ["category", "Category", "text"],
          ["author", "Author", "text"],
          // F-331: a plain text field let the owner type any string,
          // including one Date couldn't parse or a format that reads as a
          // different day once parsed (see the API routes' parseIstDateOnly
          // fix). `type="date"` guarantees a "YYYY-MM-DD" value the same
          // way the admin orders date filter already relies on
          // (parseIstDateOnly's own doc comment).
          ["publishedAt", "Published Date", "date"],
          ["readTime", "Read Time", "text"],
          ["image", "Image URL", "text"],
        ] as const
      ).map(([key, label, type]) => (
        <div key={key}>
          <label htmlFor={`blog-${key}`} className="mb-2 block text-sm font-semibold text-ink">
            {label}
          </label>
          <input
            id={`blog-${key}`}
            type={type}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
          />
        </div>
      ))}

      <div>
        <label htmlFor="blog-status" className="mb-2 block text-sm font-semibold text-ink">
          Status
        </label>
        <select
          id="blog-status"
          value={form.status}
          onChange={(e) =>
            setForm({ ...form, status: e.target.value as "DRAFT" | "PUBLISHED" })
          }
          className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
        >
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
        </select>
      </div>

      <div>
        <label htmlFor="blog-content" className="mb-2 block text-sm font-semibold text-ink">
          Content Paragraphs
        </label>
        <textarea
          id="blog-content"
          value={form.content.join("\n\n")}
          onChange={(e) =>
            setForm({ ...form, content: e.target.value.split("\n\n") })
          }
          rows={10}
          className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
          placeholder="Separate paragraphs with a blank line"
        />
      </div>

      <Button onClick={save} disabled={status === "saving"}>
        {status === "saving" ? "Saving..." : "Save Article"}
      </Button>
      {status === "error" && (
        <p className="text-sm text-red-600">Save failed. Check all fields.</p>
      )}
    </div>
  );
}
