import fs from 'node:fs';
import path from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
export const firebaseConfig: FirebaseAppletConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

export const BOOTSTRAPPED_ADMIN_EMAIL = 'mamuncox7918@gmail.com';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export interface VerifiedAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  idToken: string;
}

export async function verifyFirebaseIdToken(
  tokenHeader: string | string[] | undefined,
  fallbackAuthHeader?: string
): Promise<VerifiedAuthUser> {
  let idToken = '';
  if (typeof tokenHeader === 'string' && tokenHeader.trim()) {
    idToken = tokenHeader.trim();
  } else if (Array.isArray(tokenHeader) && tokenHeader[0]?.trim()) {
    idToken = tokenHeader[0].trim();
  } else if (fallbackAuthHeader && fallbackAuthHeader.startsWith('Bearer ')) {
    idToken = fallbackAuthHeader.slice('Bearer '.length).trim();
  }

  if (!idToken) {
    throw new HttpError(401, 'Missing authentication token. Please sign in again.');
  }

  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: `https://securetoken.google.com/${firebaseConfig.projectId}`,
      audience: firebaseConfig.projectId,
    });

    const uid = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    const emailVerified = payload.email_verified === true;

    if (!uid) {
      throw new HttpError(401, 'Invalid token subject.');
    }

    return {
      uid,
      email,
      emailVerified,
      idToken,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'Authentication session expired or invalid. Please sign in again.');
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type FirestoreRawValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreRawValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreRawValue> } };

export interface FirestoreRawDoc {
  name: string;
  fields: Record<string, FirestoreRawValue>;
  createTime: string;
  updateTime: string;
}

const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
const DOCS_ROOT = `projects/${firebaseConfig.projectId}/databases/${dbId}/documents`;
const REST_BASE = `https://firestore.googleapis.com/v1/${DOCS_ROOT}`;

export function docResourceName(collectionName: string, docId: string): string {
  return `${DOCS_ROOT}/${collectionName}/${docId}`;
}

export function encodeValue(val: unknown): FirestoreRawValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeValue) } };
  }
  if (typeof val === 'object') {
    const rawCandidate = val as Record<string, unknown>;
    if (typeof rawCandidate.__rawTimestamp === 'string') {
      return { timestampValue: rawCandidate.__rawTimestamp };
    }
    const fields: Record<string, FirestoreRawValue> = {};
    for (const [k, v] of Object.entries(rawCandidate)) {
      fields[k] = encodeValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function decodeValue(raw: FirestoreRawValue | undefined): unknown {
  if (!raw) return undefined;
  if ('stringValue' in raw) return raw.stringValue;
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return raw.doubleValue;
  if ('booleanValue' in raw) return raw.booleanValue;
  if ('timestampValue' in raw) return raw.timestampValue;
  if ('nullValue' in raw) return null;
  if ('arrayValue' in raw) return (raw.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in raw) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw.mapValue.fields || {})) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  return undefined;
}

export interface DecodedFirestoreDoc<T = Record<string, unknown>> {
  data: T;
  raw: FirestoreRawDoc;
  updateTime: string;
}

export function decodeDoc<T = Record<string, unknown>>(rawDoc: FirestoreRawDoc): DecodedFirestoreDoc<T> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawDoc.fields || {})) {
    data[k] = decodeValue(v);
  }
  return {
    data: data as T,
    raw: rawDoc,
    updateTime: rawDoc.updateTime,
  };
}

export function preserveTimestamp(rawDoc: FirestoreRawDoc, fieldName: string): { __rawTimestamp: string } {
  const field = rawDoc.fields?.[fieldName];
  if (field && 'timestampValue' in field) {
    return { __rawTimestamp: field.timestampValue };
  }
  return { __rawTimestamp: rawDoc.createTime };
}

export async function getDocRest<T = Record<string, unknown>>(
  collectionName: string,
  docId: string,
  idToken: string,
  transactionId?: string
): Promise<DecodedFirestoreDoc<T> | null> {
  const url = new URL(`${REST_BASE}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`);
  if (transactionId) {
    url.searchParams.set('transaction', transactionId);
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw parseFirestoreHttpError(res.status, errBody);
  }

  const rawDoc = (await res.json()) as FirestoreRawDoc;
  return decodeDoc<T>(rawDoc);
}

export async function queryByUserFieldRest<T = Record<string, unknown>>(
  collectionName: string,
  fieldPath: string,
  fieldValue: string,
  idToken: string
): Promise<DecodedFirestoreDoc<T>[]> {
  const res = await fetch(`${REST_BASE}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collectionName }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: { stringValue: fieldValue },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw parseFirestoreHttpError(res.status, errBody);
  }

  const rows = (await res.json()) as Array<{ document?: FirestoreRawDoc }>;
  const results: DecodedFirestoreDoc<T>[] = [];
  for (const row of rows) {
    if (row.document) {
      results.push(decodeDoc<T>(row.document));
    }
  }
  return results;
}

export async function listCollectionRest<T = Record<string, unknown>>(
  collectionName: string,
  idToken: string,
  limit = 2500
): Promise<DecodedFirestoreDoc<T>[]> {
  const res = await fetch(`${REST_BASE}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collectionName }],
        limit,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw parseFirestoreHttpError(res.status, errBody);
  }

  const rows = (await res.json()) as Array<{ document?: FirestoreRawDoc }>;
  const results: DecodedFirestoreDoc<T>[] = [];
  for (const row of rows) {
    if (row.document) {
      results.push(decodeDoc<T>(row.document));
    }
  }
  return results;
}

export interface RestWriteOperation {
  update?: {
    name: string;
    fields: Record<string, FirestoreRawValue>;
  };
  delete?: string;
  updateTransforms?: Array<{
    fieldPath: string;
    setToServerValue: 'REQUEST_TIME';
  }>;
  currentDocument?: {
    exists?: boolean;
    updateTime?: string;
  };
}

export function buildCreateWrite(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
  serverTimeFields: string[]
): RestWriteOperation {
  const fields: Record<string, FirestoreRawValue> = {};
  const timeSet = new Set(serverTimeFields);
  for (const [k, v] of Object.entries(data)) {
    if (!timeSet.has(k)) {
      fields[k] = encodeValue(v);
    }
  }
  return {
    update: {
      name: docResourceName(collectionName, docId),
      fields,
    },
    updateTransforms: serverTimeFields.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME',
    })),
    currentDocument: { exists: false },
  };
}

export function buildReplaceUpdateWrite(
  collectionName: string,
  docId: string,
  fullUpdatedData: Record<string, unknown>,
  updateTime: string,
  serverTimeFields: string[] = ['updatedAt']
): RestWriteOperation {
  const fields: Record<string, FirestoreRawValue> = {};
  const timeSet = new Set(serverTimeFields);
  for (const [k, v] of Object.entries(fullUpdatedData)) {
    if (!timeSet.has(k)) {
      fields[k] = encodeValue(v);
    }
  }
  return {
    update: {
      name: docResourceName(collectionName, docId),
      fields,
    },
    updateTransforms: serverTimeFields.map((fieldPath) => ({
      fieldPath,
      setToServerValue: 'REQUEST_TIME',
    })),
    currentDocument: { updateTime },
  };
}

export function buildDeleteWrite(collectionName: string, docId: string): RestWriteOperation {
  return {
    delete: docResourceName(collectionName, docId),
  };
}

async function commitWritesRest(idToken: string, writes: RestWriteOperation[]): Promise<void> {
  if (writes.length === 0) return;

  const res = await fetch(`${REST_BASE}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw parseFirestoreHttpError(res.status, errBody);
  }
}

export async function commitSingleOrBatchWrites(idToken: string, writes: RestWriteOperation[]): Promise<void> {
  const chunkSize = 400;
  for (let i = 0; i < writes.length; i += chunkSize) {
    await commitWritesRest(idToken, writes.slice(i, i + chunkSize));
  }
}

export async function runAtomicTransaction<R>(
  idToken: string,
  handler: (tx: {
    get: <T = Record<string, unknown>>(collectionName: string, docId: string) => Promise<DecodedFirestoreDoc<T> | null>;
  }) => Promise<{ writes: RestWriteOperation[]; result: R }>
): Promise<R> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { writes, result } = await handler({
        get: <T = Record<string, unknown>>(collectionName: string, docId: string) =>
          getDocRest<T>(collectionName, docId, idToken),
      });
      if (writes.length > 0) {
        await commitWritesRest(idToken, writes);
      }
      return result;
    } catch (err) {
      if (err instanceof HttpError && err.status === 409 && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 80 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new HttpError(409, 'Transaction contention detected. Please retry.');
}

function parseFirestoreHttpError(status: number, rawBody: string): HttpError {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string; status?: string } };
    const msg = parsed.error?.message || rawBody;
    if (msg.includes('Quota exceeded')) {
      return new HttpError(429, msg);
    }
    if (status === 403 || parsed.error?.status === 'PERMISSION_DENIED') {
      return new HttpError(403, `Permission denied by database security policy: ${msg}`);
    }
    if (
      status === 409 ||
      parsed.error?.status === 'ABORTED' ||
      parsed.error?.status === 'ALREADY_EXISTS' ||
      parsed.error?.status === 'FAILED_PRECONDITION'
    ) {
      return new HttpError(409, 'Concurrent modification or duplicate operation blocked.');
    }
    return new HttpError(status >= 400 && status < 600 ? status : 500, msg);
  } catch {
    return new HttpError(status >= 400 && status < 600 ? status : 500, rawBody || 'Database operation failed.');
  }
}
