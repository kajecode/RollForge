type Hit = { id: string; score: number; src: "vec"|"kw"; payload: any };
const K = 60; // RRF constant; larger = flatter weighting

export function rrfMerge(vec: Hit[], kw: Hit[], limit: number) {
  const map = new Map<string, { payload: any; rrf: number }>();

  function apply(list: Hit[]) {
    list.forEach((h, idx) => {
      const rrf = 1 / (K + (idx + 1));
      const prev = map.get(h.id);
      if (prev) prev.rrf += rrf;
      else map.set(h.id, { payload: h.payload, rrf });
    });
  }
  apply(vec);
  apply(kw);

  return Array.from(map.entries())
    .sort((a,b)=>b[1].rrf - a[1].rrf)
    .slice(0, limit)
    .map(([,v]) => v.payload);
}
