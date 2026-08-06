export const DISPOSITIONS: { value: string; label: string }[] = [
  { value: 'phone_screen', label: 'Phone Screen' },
  { value: 'interview', label: 'Interview' },
  { value: 'second_interview', label: '2nd Interview' },
  { value: 'third_interview', label: '3rd Interview' },
  { value: 'final_interview', label: 'Final Interview' },
  { value: 'make_offer', label: 'Make Offer' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'hired', label: 'Hired' },
  { value: 'withdrew', label: 'Withdrew' },
  { value: 'did_not_select', label: 'Did Not Select' }
];

export function dispositionLabel(value: string | null | undefined): string {
  return DISPOSITIONS.find((d) => d.value === value)?.label ?? value ?? '';
}
