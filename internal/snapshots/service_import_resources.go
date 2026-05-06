package snapshots

import (
	"encoding/json"
	"errors"
	"fmt"

	"ClawDeckX/internal/database"
)

func (s *Service) CreateFromResources(note, trigger, password string, resources []ResourceContent) (*database.SnapshotRecord, error) {
	if trigger == "" { trigger = DefaultSnapshotTag }
	if len(password) < 6 { return nil, errors.New("password too short") }
	if len(resources) == 0 { return nil, errors.New("no resources to backup") }
	existing, _ := s.repo.List()
	if len(existing) >= MaxSnapshotCount { return nil, fmt.Errorf("snapshot limit reached (%d), please delete old snapshots first", MaxSnapshotCount) }
	manifest, err := buildManifest(resources)
	if err != nil { return nil, err }
	bundle, err := packBundle(manifest, resources)
	if err != nil { return nil, err }
	kdfJSON, saltB64, wrappedDEKB64, wrapNonceB64, dataNonceB64, ciphertext, err := encryptBundleWithEnvelope(password, bundle)
	if err != nil { return nil, err }
	summaryJSON, _ := json.Marshal(map[string]any{"resource_ids": idsOfManifest(manifest.Resources), "resource_paths": logicalPathsOfManifest(manifest.Resources), "config_field_count": len(manifest.ConfigFields)})
	types := map[string]int{}
	for _, r := range manifest.Resources { types[r.Type]++ }
	typesJSON, _ := json.Marshal(types)
	rec := &database.SnapshotRecord{SnapshotID: newSnapshotID(), SnapshotVersion: SnapshotVersion1, Note: note, Trigger: trigger, ResourceCount: len(manifest.Resources), ResourceTypesJSON: string(typesJSON), ManifestSummaryJSON: string(summaryJSON), SizeBytes: int64(len(ciphertext)), CipherAlg: "aes-256-gcm", KDFAlg: "argon2id", KDFParamsJSON: kdfJSON, SaltB64: saltB64, WrappedDEKB64: wrappedDEKB64, WrapNonceB64: wrapNonceB64, DataNonceB64: dataNonceB64, Ciphertext: ciphertext}
	if err := s.repo.Create(rec); err != nil { return nil, err }
	return rec, nil
}
