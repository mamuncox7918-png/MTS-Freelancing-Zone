import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Image as ImageIcon, Maximize2, X } from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '../lib/firebase';
import { MediaAsset } from '../types';

const mediaCache = new Map<string, string>();

export function primeMediaCache(assetId: string, dataUrl: string) {
  if (assetId && dataUrl) {
    mediaCache.set(assetId, dataUrl);
  }
}

export function useMediaUrl(assetId: string | undefined | null) {
  const [url, setUrl] = useState<string | null>(() =>
    assetId ? mediaCache.get(assetId) || null : null
  );
  const [loading, setLoading] = useState<boolean>(Boolean(assetId && !mediaCache.has(assetId)));

  useEffect(() => {
    if (!assetId) {
      setUrl(null);
      setLoading(false);
      return;
    }
    const cached = mediaCache.get(assetId);
    if (cached) {
      setUrl(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const path = `mediaAssets/${assetId}`;

    getDoc(doc(db, 'mediaAssets', assetId))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as MediaAsset;
          if (data.dataUrl) {
            mediaCache.set(assetId, data.dataUrl);
            setUrl(data.dataUrl);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
          handleFirestoreError(err, OperationType.GET, path);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return { url, loading };
}

export function AvatarDisplay({
  photoAssetId,
  fullName,
  sizeClass = 'w-11 h-11 text-sm',
  previewOverride,
  zoomable = false,
}: {
  photoAssetId?: string;
  fullName: string;
  sizeClass?: string;
  previewOverride?: string | null;
  zoomable?: boolean;
}) {
  const { url } = useMediaUrl(previewOverride ? null : photoAssetId);
  const [imgFailed, setImgFailed] = useState(false);
  const [openPhotoModal, setOpenPhotoModal] = useState(false);

  const activeSrc = previewOverride !== undefined ? previewOverride : url;
  const initials = (fullName || 'M')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  if (activeSrc && !imgFailed) {
    const imgElement = (
      <img
        src={activeSrc}
        alt={`${fullName} profile photo`}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${sizeClass} rounded-2xl object-cover border border-teal-400/35 bg-[#0E1833] shrink-0`}
      />
    );

    if (!zoomable) {
      return imgElement;
    }

    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenPhotoModal(true);
          }}
          className="relative group rounded-2xl shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          title="Tap to view full profile photo"
        >
          {imgElement}
          <span className="absolute bottom-1 right-1 w-5 h-5 rounded-md bg-black/70 text-teal-300 flex items-center justify-center opacity-90 group-hover:opacity-100">
            <Maximize2 className="w-3 h-3" />
          </span>
        </button>

        {openPhotoModal && (
          <div
            className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={(e) => {
              e.stopPropagation();
              setOpenPhotoModal(false);
            }}
          >
            <div
              className="relative max-w-md w-full bg-[#0B142C] border border-white/15 rounded-3xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
                <p className="text-sm font-semibold text-white truncate">{fullName} · Profile Photo</p>
                <button
                  type="button"
                  onClick={() => setOpenPhotoModal(false)}
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-sky-200/80 hover:text-white rounded-xl"
                  aria-label="Close profile photo preview"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 flex items-center justify-center bg-[#060B19]">
                <img
                  src={activeSrc}
                  alt={`${fullName} full profile photo`}
                  referrerPolicy="no-referrer"
                  className="max-h-[70dvh] w-auto object-contain rounded-2xl"
                />
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-2xl bg-gradient-to-br from-teal-500/25 via-emerald-500/15 to-[#0E1833] border border-teal-400/30 text-teal-200 font-semibold flex items-center justify-center shrink-0 select-none`}
      aria-label={`${fullName} avatar`}
    >
      {initials || 'M'}
    </div>
  );
}

export function ProofScreenshotViewer({
  assetId,
  title,
  compact = false,
}: {
  assetId: string;
  title: string;
  compact?: boolean;
}) {
  const { url, loading } = useMediaUrl(assetId);
  const [openModal, setOpenModal] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (loading) {
    return (
      <div
        className={`${
          compact ? 'h-20 w-28' : 'h-44 w-full'
        } rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xs text-sky-200/60`}
      >
        Loading proof...
      </div>
    );
  }

  if (!url || imgError) {
    return (
      <div
        className={`${
          compact ? 'h-20 w-28' : 'h-36 w-full'
        } rounded-xl bg-[#0D1730] border border-white/10 flex flex-col items-center justify-center gap-1.5 text-xs text-sky-200/60 px-3 text-center`}
      >
        <ImageIcon className="w-5 h-5 text-sky-300/50" />
        <span>Screenshot unavailable</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenModal(true)}
        className={`group relative overflow-hidden rounded-xl border border-white/10 bg-[#0A1226] text-left transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
          compact ? 'h-20 w-28 shrink-0' : 'h-48 w-full'
        }`}
      >
        <img
          src={url}
          alt={`Proof screenshot for ${title}`}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent flex items-end justify-between p-2.5">
          <span className="text-[11px] font-medium text-white truncate pr-2">Inspect Proof</span>
          <Maximize2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
        </div>
      </button>

      {openModal && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpenModal(false)}
        >
          <div
            className="relative max-w-3xl w-full max-h-[90dvh] bg-[#0B142C] border border-white/15 rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <p className="text-sm font-semibold text-white truncate">{title}</p>
              <button
                type="button"
                onClick={() => setOpenModal(false)}
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-sky-200/80 hover:text-white rounded-xl"
                aria-label="Close screenshot preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-auto flex items-center justify-center bg-[#060B19]">
              <img
                src={url}
                alt={`Full proof screenshot for ${title}`}
                referrerPolicy="no-referrer"
                className="max-h-[75dvh] w-auto object-contain rounded-lg"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
