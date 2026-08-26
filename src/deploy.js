import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative, extname } from 'path';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import PQueue from 'p-queue';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
};

function mimeType(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function* walkDir(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkDir(full);
    else yield full;
  }
}

// Upload all files in outDir to s3://bucket[/prefix].
// options.onUpload(key) is called after each successful upload.
// options.delete=true removes S3 objects that are not in outDir.
// options.concurrency controls parallel uploads (default 8).
export async function deploy(outDir, bucket, {
  prefix = '',
  delete: doDelete = false,
  concurrency = 8,
  onUpload = null,
} = {}) {
  if (!existsSync(outDir)) {
    throw new Error(`outDir '${outDir}' does not exist — run 'tex4npm build' first`);
  }

  const client = new S3Client({});
  const queue = new PQueue({ concurrency });

  const files = [];
  for await (const filePath of walkDir(outDir)) {
    files.push(filePath);
  }

  if (files.length === 0) {
    throw new Error(`No files found in '${outDir}' — run 'tex4npm build' first`);
  }

  const uploadedKeys = new Set();

  await Promise.all(files.map(async filePath => {
    const rel = relative(outDir, filePath);
    const key = prefix ? `${prefix}/${rel}` : rel;

    await queue.add(async () => {
      const body = await readFile(filePath);
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mimeType(filePath),
      }));
    });

    uploadedKeys.add(key);
    onUpload?.(key);
  }));

  let deletedCount = 0;

  if (doDelete) {
    const toDelete = [];
    let token;
    do {
      const resp = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: token,
      }));
      for (const obj of resp.Contents ?? []) {
        if (!uploadedKeys.has(obj.Key)) toDelete.push({ Key: obj.Key });
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);

    // S3 DeleteObjects accepts at most 1000 keys per request.
    for (let i = 0; i < toDelete.length; i += 1000) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: toDelete.slice(i, i + 1000) },
      }));
    }
    deletedCount = toDelete.length;
  }

  return { uploaded: uploadedKeys.size, deleted: deletedCount };
}
