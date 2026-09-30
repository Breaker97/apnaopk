import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";

/**
 * The work of `db:migrate private-storage`: every object under a private
 * prefix in the public bucket is copied to the private bucket under the same
 * key, checked there, and only then deleted from the public one. Kept out of
 * the script so it can be tested against a bucket that is not real.
 */

type ObjectRef = { key: string; size: number };

interface PrivateMoveReport {
  prefixes: Array<{ prefix: string; count: number; bytes: number }>;
  moved: number;
  movedBytes: number;
  failures: string[];
}

async function listUnder(
  client: Pick<S3Client, "send">,
  bucket: string,
  prefix: string,
): Promise<ObjectRef[]> {
  const objects: ObjectRef[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: cursor,
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key && !object.Key.endsWith("/")) {
        objects.push({ key: object.Key, size: object.Size ?? 0 });
      }
    }
    cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (cursor);
  return objects;
}

/** `x-amz-copy-source`: the bucket, then the key URL-encoded segment by segment. */
export function copySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function movePrivateObjects(
  client: Pick<S3Client, "send">,
  options: {
    publicBucket: string;
    privateBucket: string;
    prefixes: readonly string[];
    dryRun: boolean;
    /** Each object considered, for the script's listing. */
    onObject?: (object: ObjectRef) => void;
  },
): Promise<PrivateMoveReport> {
  const { publicBucket, privateBucket, dryRun } = options;
  const report: PrivateMoveReport = {
    prefixes: [],
    moved: 0,
    movedBytes: 0,
    failures: [],
  };

  for (const prefix of options.prefixes) {
    const objects = await listUnder(client, publicBucket, prefix);
    report.prefixes.push({
      prefix,
      count: objects.length,
      bytes: objects.reduce((sum, object) => sum + object.size, 0),
    });

    for (const object of objects) {
      options.onObject?.(object);
      if (dryRun) {
        report.moved++;
        report.movedBytes += object.size;
        continue;
      }
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: privateBucket,
            Key: object.key,
            CopySource: copySource(publicBucket, object.key),
          }),
        );
        const copied = await client.send(
          new HeadObjectCommand({ Bucket: privateBucket, Key: object.key }),
        );
        if ((copied.ContentLength ?? -1) !== object.size) {
          throw new Error(
            `the copy is ${copied.ContentLength ?? "?"} bytes, the original ${object.size}`,
          );
        }
        await client.send(
          new DeleteObjectCommand({ Bucket: publicBucket, Key: object.key }),
        );
        report.moved++;
        report.movedBytes += object.size;
      } catch (error) {
        report.failures.push(
          `${object.key}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return report;
}
