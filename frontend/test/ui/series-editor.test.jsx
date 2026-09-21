import React from 'react';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect,it,vi } from 'vitest';
import MovieForm from '../../src/components/MovieForm';

const catalogs={
  countries:[],genres:[],ratingSystems:[],watchSources:[],
  presentationForms:{ movie:[],series:[] },
  subtypes:{ movie:['Feature Film'],series:['Regular Series','Limited Series','Anthology Series'] },
};

const series={
  id:'series-1',type:'series',subtype:'Regular Series',title:'Long series',originalTitle:'',
  productionStatus:'Completed',releaseStatus:'Ended',releaseDate:'2023-01-01',seriesStartDate:'2023-01-01',seriesEndDate:'2024-12-31',seriesNetwork:'',
  seriesCredits:[],productionCompanies:[],contentRatings:[],presentationForms:[],watchSources:[],watchHistory:[],contentLinks:[],genres:[],language:[],awards:[],tags:[],
  seasons:[{ id:'season-1',seasonNumber:1,title:'Season 1',productionStatus:'Completed',releaseStatus:'Released',releaseDate:'2024-01-01',posterUrl:'',synopsis:'',episodes:[
    { id:'episode-1',episodeNumber:1,title:'First',episodeType:'Pilot',director:'',duration:'40',airDate:'2024-01-02',summary:'',watchHistory:[{ id:'watch-1',watchedAt:'2024-01-10T12:00:00.000Z' }] },
    { id:'episode-2',episodeNumber:2,title:'Second',episodeType:'Regular',director:'',duration:'42',airDate:'2024-01-09',summary:'',watchHistory:[] },
  ]}],
};

it('synchronizes episode air dates and preserves keyboard watch-date editing',async () => {
  const onSubmit=vi.fn(); const user=userEvent.setup();
  render(<MovieForm initialData={series} catalogs={catalogs} onSubmit={onSubmit} onClose={vi.fn()} />);

  expect(screen.getByText('First').closest('details')).not.toHaveAttribute('open');
  const premiere=screen.getByLabelText('Season premiere date');
  fireEvent.change(premiere,{ target:{ value:'2024-02-01' } });
  fireEvent.blur(premiere);
  screen.getAllByLabelText('Episode release date').forEach((input) => expect(input).toHaveValue('2024-02-01'));

  const watchDate=screen.getByLabelText('Episode 1 watch date');
  fireEvent.change(watchDate,{ target:{ value:'2024-02-03' } });
  expect(watchDate).toHaveValue('2024-02-03');
  fireEvent.blur(watchDate);
  await user.click(screen.getByRole('button',{ name:'Save changes' }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  const saved=new Date(onSubmit.mock.calls[0][0].seasons[0].episodes[0].watchHistory[0].watchedAt);
  expect([saved.getFullYear(),saved.getMonth() + 1,saved.getDate()]).toEqual([2024,2,3]);
});

it('requires confirmation before deleting an episode from the form',() => {
  const confirmation=vi.spyOn(window,'confirm').mockReturnValue(false);
  render(<MovieForm initialData={series} catalogs={catalogs} onSubmit={vi.fn()} onClose={vi.fn()} />);
  const deleteButtons=screen.getAllByRole('button',{ name:'Remove episode' });
  fireEvent.click(deleteButtons[0]);
  expect(screen.getAllByRole('button',{ name:'Remove episode' })).toHaveLength(2);
  confirmation.mockReturnValue(true);
  fireEvent.click(deleteButtons[0]);
  expect(screen.getAllByRole('button',{ name:'Remove episode' })).toHaveLength(1);
  confirmation.mockRestore();
});
