import type { FaultStatus } from "@/lib/labels";
import { moneyInput } from "@/lib/money";
import type { FaultDetail } from "@/server/services/faults";

/** Arıza formunun değerleri (sunucu ve istemci bileşenleri ortak kullanır). */
export interface VisitValues {
  vendorId: string;
  sentOn: string;
  expectedReturnOn: string;
  serviceNote: string;
  returnedOn: string;
  workDone: string;
  costAmount: string;
  costDate: string;
  receiptRef: string;
  outcome: string;
}

export interface FaultFormValues {
  description: string;
  noticedOn: string;
  noticedByStaffId: string;
  lastUserStaffId: string;
  locationId: string;
  causeId: string;
  causeDetail: string;
  causeVerification: string;
  responsibleStaffId: string;
  responsibilityEvidence: string;
  responsibilityVerifiedByStaffId: string;
  status: FaultStatus;
  resolutionNote: string;
  resend: "" | "yes" | "no";
  visit: VisitValues;
  newVisit: VisitValues;
}

export const EMPTY_VISIT: VisitValues = {
  vendorId: "", sentOn: "", expectedReturnOn: "", serviceNote: "", returnedOn: "", workDone: "", costAmount: "", costDate: "", receiptRef: "", outcome: "",
};

export function visitToForm(v: FaultDetail["currentVisit"]): VisitValues {
  if (!v) return EMPTY_VISIT;
  return {
    vendorId: v.vendorId ?? "", sentOn: v.sentOn ?? "", expectedReturnOn: v.expectedReturnOn ?? "", serviceNote: v.serviceNote ?? "",
    returnedOn: v.returnedOn ?? "", workDone: v.workDone ?? "", costAmount: moneyInput(v.costAmount), costDate: v.costDate ?? "",
    receiptRef: v.receiptRef ?? "", outcome: v.outcome ?? "",
  };
}

export function faultToForm(f: FaultDetail): FaultFormValues {
  return {
    description: f.description, noticedOn: f.noticedOn, noticedByStaffId: f.noticedByStaffId ?? "", lastUserStaffId: f.lastUserStaffId ?? "",
    locationId: f.locationId ?? "", causeId: f.causeId, causeDetail: f.causeDetail ?? "", causeVerification: f.causeVerification,
    responsibleStaffId: f.responsibleStaffId ?? "", responsibilityEvidence: f.responsibilityEvidence ?? "",
    responsibilityVerifiedByStaffId: f.responsibilityVerifiedByStaffId ?? "", status: f.status, resolutionNote: f.resolutionNote ?? "",
    resend: "", visit: visitToForm(f.currentVisit), newVisit: EMPTY_VISIT,
  };
}

