// Datos FALSOS con la misma forma que la respuesta real de
// GET https://cmpf-tools.de/api/events (verificada el 2026-10-11).
// No usar nombres reales de participantes acá.

export const EVENT_ID = 'aaaaaaaa-1111-4222-8333-444444444444';
export const EVENT_ID_2 = 'bbbbbbbb-1111-4222-8333-444444444444';

export function member(id, name, rsvp_status = 'CHECKED_IN', extra = {}) {
  return {
    id: `E:${id}`,
    username: name,
    display_name: name,
    avatar_url: '',
    badges: null,
    rsvp_status,
    ...extra,
  };
}

export function rawEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    name: 'Día de la comunidad de prueba ✨',
    address: '-34.6, -58.5',
    lat: -34.6,
    long: -58.5,
    cover_photo_url: 'https://example.invalid/cover',
    details: 'Detalles',
    url: `https://campfire.scopely.com/discover/meetup/${EVENT_ID}`,
    time: '2026-10-10T16:00:00Z',
    end_time: '2026-10-10T21:00:00Z',
    club: {
      id: 'cccccccc-1111-4222-8333-444444444444',
      name: 'Club de prueba',
      avatar_url: '',
      badges: [],
      created_by_community_ambassador: true,
      creator: { id: 'E:CLUBOWNER', username: 'duenio', display_name: 'Dueño', avatar_url: '', badges: null },
    },
    creator: { id: 'E:CREATOR', username: 'organiza', display_name: 'Organiza', avatar_url: '', badges: null },
    discord_interested: 0,
    created_by_community_ambassador: true,
    badges: [],
    campfire_live_event: { id: 'dddddddd-1111-4222-8333-444444444444', name: 'Community Day' },
    members: [
      member('CREATOR', 'Organiza'),
      member('ANA', 'Ana'),
      member('BETO', 'Beto'),
      member('CAMI', 'Cami', 'ACCEPTED'),
      member('DANI', 'Dani', 'DECLINED'),
    ],
    ...overrides,
  };
}

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function textResponse(body, status) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
