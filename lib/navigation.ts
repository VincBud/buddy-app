type BackCapableRouter = {
  canGoBack: () => boolean;
  back: () => void;
  replace: (...args: any[]) => void;
};

export const goBackOrReplace = (
  router: BackCapableRouter,
  fallbackRoute: unknown
): void => {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallbackRoute);
};
