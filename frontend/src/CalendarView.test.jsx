import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import {
  addDays,
  addMonths,
  buildDefaultSlotRange,
  formatDayTitle,
  formatWeekRangeTitle,
  getMonthGridDays,
  getWeekDays,
  layoutTimedEventsForDay,
  normalizeEvent,
} from './calendarUtils.js';
import { CalendarioView } from './components/CalendarView.jsx';

afterEach(() => {
  cleanup();
});

const SAMPLE_EVENTS = [
  {
    id: 1,
    titulo: 'Reunión clínica',
    descripcion: 'Revisión de casos semanales.',
    responsable: 'Equipo CEMIPRE',
    inicio: '2026-11-19T12:00:00Z', // 09:00 America/Santiago (UTC-3 en noviembre)
    fin: '2026-11-19T13:30:00Z', // 10:30 America/Santiago
  },
  {
    id: 2,
    titulo: 'Taller de familia',
    descripcion: 'Sesión con apoderados.',
    responsable: 'Psicología',
    inicio: '2026-11-19T13:00:00Z', // 10:00 America/Santiago (solapa con Reunión clínica)
    fin: '2026-11-19T14:30:00Z', // 11:30 America/Santiago
  },
  {
    id: 3,
    titulo: 'Jornada anual',
    descripcion: 'Actividad institucional de 2 días.',
    responsable: 'Dirección',
    inicio: '2026-11-20T12:00:00Z', // 20 nov 09:00 CL
    fin: '2026-11-21T20:00:00Z', // 21 nov 17:00 CL
  },
];

describe('calendarUtils', () => {
  it('genera cuadrícula mensual desde lunes a domingo y respeta saltos de mes', () => {
    const nov2026 = getMonthGridDays(2026, 11);
    expect(nov2026).toHaveLength(42);
    expect(nov2026[0].dateKey).toBe('2026-10-26');
    expect(nov2026[0].isCurrentMonth).toBe(false);
    expect(nov2026[6].dateKey).toBe('2026-11-01');
    expect(nov2026[6].isCurrentMonth).toBe(true);
    expect(nov2026[nov2026.length - 1].dateKey).toBe('2026-12-06');

    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('calcula semanas (lunes a domingo), títulos y rangos de horario al cruzar medianoche', () => {
    const week = getWeekDays('2026-11-19');
    expect(week).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    expect(formatWeekRangeTitle(week)).toBe('16 – 22 nov 2026');
    expect(formatDayTitle('2026-11-19')).toBe('Jueves, 19 de noviembre de 2026');
    expect(buildDefaultSlotRange('2026-11-19', 23, 60)).toEqual({
      inicio: '2026-11-19T23:00',
      fin: '2026-11-20T00:00',
    });
  });

  it('normaliza eventos simples, hasta medianoche y de varios días en América/Santiago', () => {
    const single = normalizeEvent(SAMPLE_EVENTS[0]);
    expect(single.startKey).toBe('2026-11-19');
    expect(single.effectiveEndKey).toBe('2026-11-19');
    expect(single.isMultiDay).toBe(false);
    expect(single.isFullDayBanner).toBe(false);
    expect(single.startMinutes).toBe(9 * 60);
    expect(single.endMinutes).toBe(10 * 60 + 30);

    const untilMidnight = normalizeEvent({
      id: 9,
      titulo: 'Turno noche',
      inicio: '2026-11-20T01:00:00Z', // 19 nov 22:00 CL
      fin: '2026-11-20T03:00:00Z', // 20 nov 00:00 CL
    });
    expect(untilMidnight.startKey).toBe('2026-11-19');
    expect(untilMidnight.effectiveEndKey).toBe('2026-11-19');
    expect(untilMidnight.isMultiDay).toBe(false);
    expect(untilMidnight.endMinutes).toBe(1440);

    const multi = normalizeEvent(SAMPLE_EVENTS[2]);
    expect(multi.startKey).toBe('2026-11-20');
    expect(multi.effectiveEndKey).toBe('2026-11-21');
    expect(multi.isMultiDay).toBe(true);
    expect(multi.isFullDayBanner).toBe(true);
  });

  it('distribuye en columnas paralelas los eventos superpuestos del mismo día', () => {
    const normalized = [normalizeEvent(SAMPLE_EVENTS[0]), normalizeEvent(SAMPLE_EVENTS[1])];
    const layout = layoutTimedEventsForDay(normalized);
    expect(layout).toHaveLength(2);
    expect(layout[0].totalColumns).toBe(2);
    expect(layout[1].totalColumns).toBe(2);
    expect(layout[0].leftPct).toBe(0);
    expect(layout[0].widthPct).toBe(50);
    expect(layout[1].leftPct).toBe(50);
    expect(layout[1].widthPct).toBe(50);
  });
});

describe('CalendarioView (vistas Mensual, Semanal y Día)', () => {
  it('muestra la cuadrícula mensual por defecto incluso sin eventos y permite cambiar de mes', () => {
    const onOpenModal = vi.fn();
    render(<CalendarioView events={[]} onOpenModal={onOpenModal} initialDate="2026-11-19" />);

    expect(screen.getByRole('tab', { name: 'Mensual' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Noviembre 2026' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /Calendario mensual de Noviembre 2026/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Lunes' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Domingo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByRole('heading', { name: 'Diciembre 2026' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(screen.getByRole('heading', { name: 'Noviembre 2026' })).toBeInTheDocument();
  });

  it('cambia entre vistas Mensual, Semanal y Día mostrando los eventos y permitiendo navegar', () => {
    const onOpenModal = vi.fn();
    render(<CalendarioView events={SAMPLE_EVENTS} onOpenModal={onOpenModal} initialDate="2026-11-19" />);

    // Vista Mensual muestra los eventos en el calendario
    const monthGrid = screen.getByRole('grid', { name: /Calendario mensual/i });
    expect(within(monthGrid).getByText('Reunión clínica')).toBeInTheDocument();
    expect(within(monthGrid).getByText('Taller de familia')).toBeInTheDocument();
    expect(within(monthGrid).getAllByText('Jornada anual')).toHaveLength(2); // 20 y 21 nov

    // Cambiar a Vista Semanal
    fireEvent.click(screen.getByRole('tab', { name: 'Semanal' }));
    expect(screen.getByRole('tab', { name: 'Semanal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '16 – 22 nov 2026' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Eventos de todo el día o varios días/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mini calendario mensual/i)).toBeInTheDocument();

    // Navegar a la semana siguiente y volver
    fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(screen.getByRole('heading', { name: '23 – 29 nov 2026' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(screen.getByRole('heading', { name: '16 – 22 nov 2026' })).toBeInTheDocument();

    // Cambiar a Vista Día
    fireEvent.click(screen.getByRole('tab', { name: 'Día' }));
    expect(screen.getByRole('tab', { name: 'Día' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Jueves, 19 de noviembre de 2026' })).toBeInTheDocument();

    // Navegar al día siguiente (20 nov) donde aparece el evento de varios días
    fireEvent.click(screen.getByRole('button', { name: 'Día siguiente' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Viernes, 20 de noviembre de 2026' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Eventos de todo el día o varios días/i)).toHaveTextContent('Jornada anual');
  });

  it('permite crear eventos al pulsar un día o una franja horaria, y editar o eliminar eventos seleccionados', () => {
    const onOpenModal = vi.fn();
    render(<CalendarioView events={SAMPLE_EVENTS} onOpenModal={onOpenModal} initialDate="2026-11-19" />);

    // Crear evento desde el botón + de una celda mensual
    fireEvent.click(screen.getByRole('button', { name: /Crear evento el Viernes, 20 de noviembre de 2026/i }));
    expect(onOpenModal).toHaveBeenCalledWith('new-event', {
      inicio: '2026-11-20T09:00',
      fin: '2026-11-20T10:00',
    });

    // Seleccionar evento y abrir modal de edición y eliminación
    const monthGrid = screen.getByRole('grid', { name: /Calendario mensual/i });
    fireEvent.click(within(monthGrid).getByText('Reunión clínica'));
    expect(screen.getByText('EVENTO SELECCIONADO')).toBeInTheDocument();
    expect(screen.getByText('Revisión de casos semanales.')).toBeInTheDocument();

    const detailCard = screen.getByText('EVENTO SELECCIONADO').closest('.cal-event-detail-card');
    fireEvent.click(within(detailCard).getByRole('button', { name: 'Editar' }));
    expect(onOpenModal).toHaveBeenCalledWith(
      'edit-event',
      expect.objectContaining({
        id: 1,
        titulo: 'Reunión clínica',
        inicio: '2026-11-19T09:00',
        fin: '2026-11-19T10:30',
      }),
    );

    fireEvent.click(within(detailCard).getByRole('button', { name: 'Eliminar' }));
    expect(onOpenModal).toHaveBeenCalledWith('delete-event', SAMPLE_EVENTS[0]);

    // Crear evento desde una franja horaria en Vista Día
    fireEvent.click(screen.getByRole('tab', { name: 'Día' }));
    fireEvent.click(
      screen.getByRole('button', { name: /Crear evento el Jueves, 19 de noviembre de 2026 a las 14:00/i }),
    );
    expect(onOpenModal).toHaveBeenCalledWith('new-event', {
      inicio: '2026-11-19T14:00',
      fin: '2026-11-19T15:00',
    });

    // Saltar a otra fecha mediante el mini calendario
    fireEvent.click(screen.getByRole('button', { name: /Ir al Sábado, 21 de noviembre de 2026/i }));
    expect(screen.getByRole('heading', { level: 2, name: 'Sábado, 21 de noviembre de 2026' })).toBeInTheDocument();
  });
});
