// k-means++ clustering — no external dependencies

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function nearestCentroid(point, centroids) {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < centroids.length; i++) {
    const d = euclideanDistance(point, centroids[i]);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return { index: minIdx, distance: minDist };
}

function initCentroidsPlusPlus(vectors, k) {
  const centroids = [];
  // Pick first centroid uniformly at random
  centroids.push([...vectors[Math.floor(Math.random() * vectors.length)]]);

  for (let c = 1; c < k; c++) {
    // Compute squared distances to nearest existing centroid
    const distances = vectors.map(v => {
      const { distance } = nearestCentroid(v, centroids);
      return distance * distance;
    });
    const totalDist = distances.reduce((s, d) => s + d, 0);

    // Weighted random selection
    let r = Math.random() * totalDist;
    let selected = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) { selected = i; break; }
    }
    centroids.push([...vectors[selected]]);
  }

  return centroids;
}

function recomputeCentroids(vectors, assignments, k, dims) {
  const sums = Array.from({ length: k }, () => new Float64Array(dims));
  const counts = new Array(k).fill(0);

  for (let i = 0; i < vectors.length; i++) {
    const cluster = assignments[i];
    counts[cluster]++;
    for (let d = 0; d < dims; d++) {
      sums[cluster][d] += vectors[i][d];
    }
  }

  return sums.map((sum, i) => {
    if (counts[i] === 0) return Array.from(sum); // empty cluster keeps old centroid
    return Array.from(sum, v => v / counts[i]);
  });
}

/**
 * k-means++ clustering.
 * @param {number[][]} vectors - Array of vectors to cluster
 * @param {number} k - Number of clusters
 * @param {number} maxIterations - Maximum iterations (default 50)
 * @returns {{ assignments: number[], centroids: number[][] }}
 */
export function kmeans(vectors, k, maxIterations = 50) {
  if (!vectors.length) return { assignments: [], centroids: [] };

  // Degenerate: k >= n — each point is its own cluster
  const actualK = Math.min(k, vectors.length);
  if (actualK <= 1) {
    return {
      assignments: new Array(vectors.length).fill(0),
      centroids: [vectors[0] ? [...vectors[0]] : []],
    };
  }

  const dims = vectors[0].length;
  let centroids = initCentroidsPlusPlus(vectors, actualK);
  let assignments = new Array(vectors.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    let changed = false;
    for (let i = 0; i < vectors.length; i++) {
      const { index } = nearestCentroid(vectors[i], centroids);
      if (assignments[i] !== index) {
        assignments[i] = index;
        changed = true;
      }
    }

    if (!changed) break; // converged

    centroids = recomputeCentroids(vectors, assignments, actualK, dims);
  }

  return { assignments, centroids };
}
