// Flat map of { domId: entry }. Every entry is JSON-serializable.
// Reducers return a new object for changed entries; unchanged entries keep
// their original reference so render can skip them by identity check.
//
// Persistence is by-value (D6): modelToPageState and modelFromPageState are
// the identity function. Everything you'd want to serialize is already here.

export function initialModel() {
  return {};
}

export function getEntry(model, id) {
  return model[id] ?? {};
}

// Merge partial state into an entry. Returns a NEW model with a NEW entry
// object for the changed id; other entries keep their references.
export function setEntry(model, id, partial) {
  const prev = model[id] ?? {};
  const next = { ...prev, ...partial };
  return { ...model, [id]: next };
}

// Remove an entry. Returns a new model without that key.
export function delEntry(model, id) {
  if (!(id in model)) return model;
  const { [id]: _dropped, ...rest } = model;
  return rest;
}

// D6: persistence is the identity mapping.
export function modelToPageState(model) {
  return model;
}

export function modelFromPageState(pageState) {
  return (pageState && typeof pageState === 'object') ? pageState : {};
}
