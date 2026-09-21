import React from 'react';
import { cleanup,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,expect,it,vi } from 'vitest';
import axios from 'axios';
import Content from '../../src/components/Content';

vi.mock('axios',() => ({ default:{ get:vi.fn(),post:vi.fn(),put:vi.fn() } }));
vi.mock('../../src/components/MovieCard',() => ({ default:({ onEdit }) => <button onClick={onEdit}>Edit test title</button> }));
vi.mock('../../src/components/MovieForm',() => ({ default:({ initialData,onSubmit }) => <section aria-label="Test editor"><button onClick={() => onSubmit(initialData)}>Save test title</button></section> }));
vi.mock('../../src/components/NotificationPanel',() => ({ default:() => null }));
vi.mock('../../src/components/FilterPanel',() => ({ default:() => null }));
vi.mock('../../src/components/Statistics',() => ({ default:() => null }));
vi.mock('../../src/components/DataHealth',() => ({ default:() => null }));
vi.mock('../../src/components/LibraryTable',() => ({ default:() => null }));
vi.mock('../../src/components/ActivityLog',() => ({ default:() => null }));

const item={ id:'entry-1',type:'movie',title:'Test title',watchHistory:[],watchSources:[],contentLinks:[] };
const props={ selectedMenu:'Library',searchTerm:'',onNavigate:vi.fn(),onNotificationsChanged:vi.fn(),onTrashChanged:vi.fn() };

beforeEach(() => {
  cleanup(); vi.clearAllMocks(); window.history.replaceState({},'','/');
  axios.get.mockImplementation((url) => {
    if (url.endsWith('/catalogs')) return Promise.resolve({ data:{ countries:[],ratingSystems:[],genres:[],presentationForms:{ movie:[],series:[] },watchSources:[],subtypes:{ movie:[],series:[] } } });
    if (url.endsWith('/notifications')) return Promise.resolve({ data:{ notifications:[] } });
    if (url.endsWith('/content/entry-1')) return Promise.resolve({ data:item });
    return Promise.resolve({ data:{ items:[item],total:1,page:1,pages:1 } });
  });
  axios.put.mockResolvedValue({ data:{ message:'Saved' } });
});

it('consumes editor query links once and does not persist them after opening or saving',async () => {
  const user=userEvent.setup();
  window.history.replaceState({},'','/?edit=entry-1');
  const view=render(<Content {...props} />);
  expect(await screen.findByRole('region',{ name:'Test editor' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
  await user.click(screen.getByRole('button',{ name:'Save test title' }));
  await waitFor(() => expect(axios.put).toHaveBeenCalled());
  expect(window.location.search).toBe('');

  view.unmount();
  render(<Content {...props} />);
  await screen.findByRole('button',{ name:'Edit test title' });
  expect(screen.queryByRole('region',{ name:'Test editor' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{ name:'Edit test title' }));
  expect(await screen.findByRole('region',{ name:'Test editor' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
});
