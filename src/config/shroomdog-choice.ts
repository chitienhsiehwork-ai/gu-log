export const SHROOMDOG_CHOICE_TICKET_IDS = ['GP-127', 'GP-101', 'GP-110'] as const;

export function assertUniqueShroomDogChoiceTicketIds(ticketIds: readonly string[]): void {
  const seen = new Set<string>();

  for (const ticketId of ticketIds) {
    if (seen.has(ticketId)) {
      throw new Error(`Duplicate ShroomDog’s Choice ticketId: ${ticketId}`);
    }
    seen.add(ticketId);
  }
}

assertUniqueShroomDogChoiceTicketIds(SHROOMDOG_CHOICE_TICKET_IDS);
