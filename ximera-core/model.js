export function initialModel() {
  return {};
}

export function modelFromPageState(pageState) {
  return (pageState && typeof pageState === 'object') ? pageState : {};
}

export function modelToPageState(model) {
  return model;
}

export function getElementState(model, id) {
  return model[id] ?? {};
}

export function setElementState(model, id, state) {
  return { ...model, [id]: { ...getElementState(model, id), ...state } };
}
