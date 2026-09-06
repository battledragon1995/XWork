import type {
  UnifiedSearchError,
  UnifiedSearchInputDto,
  UnifiedSearchResponseDto,
} from "@/bindings/search";
import { invokeCommand } from "./ipc-error";

/** Query the real Phase 1 unified-search boundary. */
export function searchUnified(input: UnifiedSearchInputDto): Promise<UnifiedSearchResponseDto> {
  return invokeCommand<UnifiedSearchResponseDto, UnifiedSearchError>("search_unified", { input });
}
