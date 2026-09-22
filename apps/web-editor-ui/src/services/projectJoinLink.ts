interface ProjectJoinLink {
  url: string;
  path?: string;
}

const JOIN_PATH_PATTERN = /^\/join\/[A-Za-z0-9_-]{32,256}$/u;

export const projectJoinLinkForCurrentOrigin = (
  link: ProjectJoinLink,
  origin: string,
) => {
  const path = link.path ?? new URL(link.url).pathname;
  if (!JOIN_PATH_PATTERN.test(path)) {
    throw new Error("Le lien collaborateur reçu n'est pas valide.");
  }
  return new URL(path, origin).toString();
};
