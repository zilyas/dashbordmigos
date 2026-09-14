import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getUploadAdapter } from "@/lib/storage";

// Cheap first gate on the client-declared MIME type. The adapters are the
// real authority — they decode the bytes with sharp and reject anything that
// is not genuinely one of these formats — but rejecting here avoids buffering
// 5MB of a file we were never going to accept.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || !can(session.user.role, "product.create")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use JPEG, PNG, WEBP or GIF." },
      { status: 400 }
    );
  }

  try {
    const url = await getUploadAdapter().save(file);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
