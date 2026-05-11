export type MergecraftDoc = {
  title: string;
  cubes: [number, number, number][];
};

export const defaultMergecraftDoc = (): MergecraftDoc => ({
  title: "Mergecraft World",
  cubes: [[0, 0.5, -10]],
});

const getTitle = (doc: MergecraftDoc) => {
  return doc.title || "Mergecraft World";
};

const setTitle = (doc: MergecraftDoc, title: string) => {
  doc.title = title;
};

const init = (doc: MergecraftDoc) => {
  const seed = defaultMergecraftDoc();
  doc.title = seed.title;
  doc.cubes = seed.cubes;
};

export const dataType = {
  init,
  getTitle,
  setTitle,
};
