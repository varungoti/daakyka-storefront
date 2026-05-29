"use client";

import { Button } from "@/components/ui/button";
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
      publishedAt: new Date().toISOString().slice(0, 10),
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
    <div className="space-y-4 rounded-3xl border border-border bg-white p-6">
      {(
        [
          ["title", "Title"],
          ["slug", "Slug"],
          ["excerpt", "Excerpt"],
          ["category", "Category"],
          ["author", "Author"],
          ["publishedAt", "Published Date"],
          ["readTime", "Read Time"],
          ["image", "Image URL"],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <label htmlFor={`blog-${key}`} className="mb-2 block text-sm font-semibold text-ink">
            {label}
          </label>
          <input
            id={`blog-${key}`}
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
