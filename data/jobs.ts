export let jobs: any[] = [];

export const addJob = (job: any) => {
  jobs.unshift(job);
};
