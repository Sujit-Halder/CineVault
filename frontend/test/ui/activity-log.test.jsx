import React from 'react';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,expect,it,vi } from 'vitest';
import axios from 'axios';
import ActivityLog from '../../src/components/ActivityLog';

vi.mock('axios',() => ({ default:{ get:vi.fn() } }));

const activityEvent={
  id:1,action:'restore-merge',category:'Library',severity:'info',entityType:'content',entityId:'title-1',subjectTitle:'Merged title',
  actor:'owner',outcome:'success',details:{ mergedFrom:'old-title',backupFile:'pre-restore.sqlite' },before:null,after:null,metadata:{},requestId:'request-1',createdAt:'2026-09-21T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  axios.get.mockResolvedValue({ data:{ total:1,page:1,pages:1,events:[activityEvent] } });
});

it('renders readable merge activity and opens the affected title',async () => {
  const onOpen=vi.fn(); const user=userEvent.setup();
  render(<ActivityLog onOpen={onOpen} onClose={vi.fn()} />);
  expect(await screen.findByText('“Merged title” was merged during conflict resolution')).toBeInTheDocument();
  await user.click(screen.getByText('“Merged title” was merged during conflict resolution'));
  await user.click(screen.getByRole('button',{ name:'Open title' }));
  expect(onOpen).toHaveBeenCalledWith('title-1');
  await user.selectOptions(screen.getByLabelText('Activity category'),'Library');
  await waitFor(() => expect(axios.get).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({ params:expect.objectContaining({ category:'Library' }) })));
});

it('shows a long-form calendar date while retaining the event time',async () => {
  render(<ActivityLog onOpen={vi.fn()} onClose={vi.fn()} />);
  expect(await screen.findByText(/September 21, 2026 at \d{1,2}:\d{2}:\d{2} [AP]M/)).toBeInTheDocument();
});

it('submits outcome and calendar-range filters to the audit endpoint',async () => {
  const user=userEvent.setup();
  render(<ActivityLog onOpen={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText('“Merged title” was merged during conflict resolution');
  await user.selectOptions(screen.getByLabelText('Activity outcome'),'failure');
  fireEvent.change(screen.getByLabelText('Activity from date'),{ target:{ value:'2026-09-01' } });
  fireEvent.change(screen.getByLabelText('Activity to date'),{ target:{ value:'2026-09-21' } });
  await waitFor(() => expect(axios.get).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({ params:expect.objectContaining({
    outcome:'failure',from:'2026-09-01',to:'2026-09-21',page:1,
  }) })));
});

it('requests the next activity page and returns to the top of the timeline',async () => {
  const user=userEvent.setup();
  const scrollIntoView=vi.fn();
  Element.prototype.scrollIntoView=scrollIntoView;
  axios.get.mockImplementation((url,{ params }) => Promise.resolve({ data:{ total:31,page:params.page,pages:2,events:[{ ...activityEvent,id:params.page,subjectTitle:`Page ${params.page}` }] } }));
  render(<ActivityLog onOpen={vi.fn()} onClose={vi.fn()} />);
  await screen.findByText('“Page 1” was merged during conflict resolution');
  await user.click(screen.getByRole('button',{ name:'Next' }));
  expect(await screen.findByText('“Page 2” was merged during conflict resolution')).toBeInTheDocument();
  expect(axios.get).toHaveBeenLastCalledWith(expect.any(String),expect.objectContaining({ params:expect.objectContaining({ page:2 }) }));
  expect(scrollIntoView).toHaveBeenCalled();
});
