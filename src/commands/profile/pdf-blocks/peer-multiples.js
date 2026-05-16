/**
 * Peer Median Multiples block (MH5).
 *
 * Computes simple median peer metrics (marge EBITDA, ROE, croissance YoY)
 * via pappersSearchPeers + delta vs own metrics. Fail-soft : si sampleSize<3
 * → median=null + narrative "échantillon insuffisant", pas de PDF crash.
 */

import { pappersSearchPeers } from '../../../scrapers/pappers-peers.js';

function median(values) {
  const cleaned = values.filter(v => v != null && Number.isFinite(v));
  if (cleaned.length === 0) return null;
  const sorted = [...cleaned].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function delta(own, peer) {
  if (own == null || peer == null || !Number.isFinite(own) || !Number.isFinite(peer)) return null;
  return own - peer;
}

/**
 * Build peer multiples block.
 *
 * @param {Object} params
 * @param {string} params.naf
 * @param {string} params.sirenSelf
 * @param {Object} [params.ownMetrics] — { margeEbitda, roe, growthYoY }
 * @returns {Promise<{median:Object|null, sampleSize:number, vsOwn:Object, fromCache:boolean, narrative?:string}>}
 */
export async function buildPeerMultiplesBlock({ naf, sirenSelf, ownMetrics = {} }) {
  if (!naf) {
    return {
      median: null,
      sampleSize: 0,
      vsOwn: { margeEbitdaDelta: null, roeDelta: null, growthDelta: null },
      fromCache: false,
      narrative: 'NAF absent — peers non calculables.',
    };
  }

  let peers = [];
  try {
    peers = await pappersSearchPeers(naf, sirenSelf, { limit: 10 });
  } catch (err) {
    console.error('peer-multiples pappersSearchPeers threw', { naf, err: err.message });
    peers = [];
  }

  const sampleSize = peers.length;

  if (sampleSize < 3) {
    return {
      median: null,
      sampleSize,
      vsOwn: { margeEbitdaDelta: null, roeDelta: null, growthDelta: null },
      fromCache: false,
      narrative: `Échantillon insuffisant (${sampleSize} pair${sampleSize > 1 ? 's' : ''} retourné${sampleSize > 1 ? 's' : ''} sur NAF ${naf}). Multiples médians non calculés.`,
    };
  }

  const medMarge = median(peers.map(p => p.margeEbitda));
  const medRoe = median(peers.map(p => p.roe));
  const medGrowth = median(peers.map(p => p.croissance));

  const medianBlock = {
    margeEbitda: medMarge,
    roe: medRoe,
    growthYoY: medGrowth,
  };

  const vsOwn = {
    margeEbitdaDelta: delta(ownMetrics.margeEbitda, medMarge),
    roeDelta: delta(ownMetrics.roe, medRoe),
    growthDelta: delta(ownMetrics.growthYoY, medGrowth),
  };

  return {
    median: medianBlock,
    sampleSize,
    vsOwn,
    fromCache: false,
    peers: peers.map(p => ({
      siren: p.siren,
      name: p.name,
      ca: p.ca,
      margeEbitda: p.margeEbitda,
      roe: p.roe,
      croissance: p.croissance,
    })),
  };
}
