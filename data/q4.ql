[out:json][timeout:280];
(
  way["waterway"="river"]["name"~"سندھ|Indus|Sindhu"](23.4,60.8,37.2,77.9);
  way["waterway"="river"]["name:en"~"Indus"](23.4,60.8,37.2,77.9);
  way["waterway"="river"]["name"~"جہلم|چناب|راوی|ستلج|کابل|سوات|پنجند"](23.4,60.8,37.2,77.9);
);
out geom;
