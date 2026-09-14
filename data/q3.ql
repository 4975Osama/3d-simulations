[out:json][timeout:280];
(
  way["natural"="water"]["water"~"river|reservoir|lake"](27.4,68.5,28.2,69.2);
  rel["natural"="water"]["water"~"river|reservoir|lake"](27.4,68.5,28.2,69.2);
  way["natural"="water"]["water"~"river|reservoir|lake"](33.6,72.6,34.3,73.3);
  rel["natural"="water"]["water"~"river|reservoir|lake"](33.6,72.6,34.3,73.3);
);
out geom;
