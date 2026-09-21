// Defines lifecycle choices and concise explanations shared by editors and filters.
export const PRODUCTION_STATUSES = [
  ['Rumored','Reported or discussed, but not officially confirmed'],
  ['Announced','Officially confirmed by the studio, network, or platform'],
  ['In Development','Scripts, rights, financing, casting, or planning are underway'],
  ['Pre-Production','Casting, scheduling, locations, and other preparations are underway'],
  ['Filming / Production','Principal photography, animation production, or another active production process is underway'],
  ['Post-Production','Editing, visual effects, sound, music, or dubbing are underway'],
  ['Completed','Production is finished'],
  ['Canceled','The project was officially stopped'],
  ['Shelved','The project was halted or withheld indefinitely'],
];

export const MOVIE_RELEASE_STATUSES = [
  ['Unscheduled','No public release date or release window is set'],
  ['Upcoming','Public release is expected but has not occurred'],
  ['Released','Officially available to the public'],
  ['Canceled','The planned public release was canceled'],
  ['Withheld','Completed or partly completed but not publicly released'],
];

export const SERIES_RELEASE_STATUSES = [
  ['Unscheduled','No public premiere date or release window is set'],
  ['Upcoming','The series is expected but has not premiered'],
  ['Airing','Episodes are currently being released'],
  ['Between Seasons','Released series awaiting its next confirmed or expected season'],
  ['Hiatus','Temporarily paused without being ended'],
  ['Returning','A new season is confirmed after a break'],
  ['Ended','The series concluded normally'],
  ['Canceled','Continuation was officially stopped'],
];

export const SEASON_RELEASE_STATUSES = [
  ['Unscheduled','No premiere date or release window is set'],
  ['Upcoming','The season is expected but has not premiered'],
  ['Airing','Episodes from this season are currently being released'],
  ['Released','The season has been publicly released'],
  ['Canceled','The season was officially canceled'],
];

export const MOVIE_VIEWING_STATUSES = [
  ['Not Watched','No movie watch date is recorded'],
  ['Watched','At least one movie watch date is recorded'],
];

export const SERIES_VIEWING_STATUSES = [
  ['Not Started','No episode has a watch date'],
  ['In Progress','Some, but not all, existing episodes have a watch date'],
  ['Completed','Every existing episode has at least one watch date'],
];
