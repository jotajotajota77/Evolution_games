// Pseudo-binomial name generator. Inspired by latin taxonomy + sci-fi
// taxon names. Used for the suggested name when creating a new lineage and
// for naming sub-species when speciation events fire.

const GENERA = [
  'Xenotauri', 'Cryopora', 'Plasmovita', 'Nebulae', 'Necropteryx',
  'Photogen', 'Symbiomorpha', 'Aetherspora', 'Vorthidae', 'Eunoetus',
  'Heliotrope', 'Chronoxenus', 'Stellaria', 'Pulsorix', 'Quantophorus',
  'Anabiomorpha', 'Pyrocaecius', 'Geliderma', 'Thaumarctos', 'Trilophion',
  'Selenodon', 'Andromedis', 'Cosmocaris', 'Mycopodion', 'Sublimaris',
  'Plasmaphytum', 'Quasarion', 'Veridian', 'Cryptolux', 'Nyxoroth',
  'Tachyphor', 'Vortilum', 'Solenodonta', 'Hexaclonus', 'Mereton',
  'Lirathenia', 'Volkmarisia', 'Tessellaeus', 'Iridarothrix', 'Cataphractus',
  'Aeonis', 'Pyralia', 'Helvetia', 'Voltaria', 'Lumeneon',
  'Erebus', 'Cygnaris', 'Tritonax', 'Marabunta', 'Khorios',
];

const EPITHETS = [
  'vorax', 'prima', 'celer', 'fulgens', 'umbra',
  'novus', 'antiquus', 'mirabilis', 'sapiens', 'gracilis',
  'major', 'minor', 'sylvestris', 'oceanica', 'crepuscularis',
  'paradoxa', 'cryptica', 'magnifica', 'humilis', 'rapax',
  'fortis', 'fugax', 'tenebris', 'lucida', 'errans',
  'vagans', 'silens', 'callida', 'nebularis', 'galactica',
  'stellaris', 'siderea', 'quaesita', 'aurea', 'argentea',
  'fervens', 'frigida', 'ventosa', 'caelestis', 'profunda',
  'aquila', 'titanica', 'parva', 'gigantica', 'ferox',
  'pacifica', 'borealis', 'australis', 'orientalis', 'occidentalis',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomBinomial() {
  return `${pick(GENERA)} ${pick(EPITHETS)}`;
}

export function randomEpithet() {
  return pick(EPITHETS);
}

// Takes the first whitespace-separated word as the genus. Used for derived
// child names so a sub-species shares its parent's genus.
export function genusOf(name) {
  return (name || '').trim().split(/\s+/)[0] || 'Incertae';
}

// FNV-1a 32-bit string hash. Used to derive deterministic epithet indices
// from a seed so two phylo trees that speciate from the same event roll
// the same name.
function fnvHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Builds a sub-species name keeping the parent genus and picking a new
// epithet. When `seed` is provided the epithet is chosen deterministically
// (FNV hash of the seed → epithet index), so cladistic and matriarchal
// trees that share the same lineage + tick + role roll the same name.
export function deriveChildName(parentName, seed) {
  const genus = genusOf(parentName);
  const epithet = seed
    ? EPITHETS[fnvHash(seed) % EPITHETS.length]
    : pick(EPITHETS);
  return `${genus} ${epithet}`;
}
