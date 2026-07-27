# Backend Tasks & Subtasks Breakdown

## Phase 1: Repository Layer (Foundation)

### Task 1.1: Inpatient Journeys Repository
**File**: `server/repositories/inpatient_journeys_repository.cjs`

#### Subtasks:
- [ ] Extend BaseRepository class
- [ ] Implement CRUD operations:
  - [ ] `createJourney(journeyData)` - Insert new journey with encounter linking
  - [ ] `findJourneyById(id)` - Retrieve single journey by ID
  - [ ] `findJourneysByPatient(patientId)` - Get all patient journeys
  - [ ] `findActiveJourneysByLocation(locationId)` - Get active admissions by location
  - [ ] `updateJourney(id, updateData)` - General journey updates
  - [ ] `updateJourneyStatus(id, status, dischargeData)` - Status transitions
  - [ ] `deleteJourney(id)` - Soft delete with audit trail
- [ ] Implement domain-specific queries:
  - [ ] `getJourneyStats()` - Aggregate journey statistics
  - [ ] `findJourneysByDateRange(startDate, endDate)` - Date-based filtering
  - [ ] `findJourneysByStatus(status)` - Status-based queries
  - [ ] `getJourneyTimeline(journeyId)` - Timeline of journey events
- [ ] Add transaction support for multi-table operations
- [ ] Implement JSONB field handling for flexible data
- [ ] Add proper indexes and query optimization
- [ ] Error handling and validation

### Task 1.2: Daily Notes Repository
**File**: `server/repositories/daily_notes_repository.cjs`

#### Subtasks:
- [ ] Extend BaseRepository class
- [ ] Implement CRUD operations:
  - [ ] `createDailyNote(noteData)` - Insert new daily note
  - [ ] `findNoteById(id)` - Retrieve single note
  - [ ] `findNotesByJourney(journeyId)` - Get all notes for journey
  - [ ] `findNotesByDateRange(patientId, startDate, endDate)` - Date filtering
  - [ ] `findLatestNoteByType(journeyId, noteType)` - Get most recent note by type
  - [ ] `updateNote(id, updateData)` - Update note content
  - [ ] `updateNoteStatus(id, status, reviewData)` - Status workflow
  - [ ] `deleteNote(id)` - Soft delete
- [ ] Implement daily note specific queries:
  - [ ] `getDailyNotesTimeline(journeyId)` - Timeline view
  - [ ] `findNotesByStatus(status)` - Status-based filtering
  - [ ] `findNotesNeedingReview()` - Quality control queries
  - [ ] `findUnverifiedNotes()` - Paper-extracted notes needing verification
- [ ] Voice integration methods:
  - [ ] `linkVoiceSession(noteId, sessionId, transcriptId)` - Link voice data
  - [ ] `findNotesByVoiceSession(sessionId)` - Query by voice session
- [ ] Paper digitization support:
  - [ ] `findNotesBySource(sourceType)` - Filter by source (manual/voice/paper)
  - [ ] `updateVerificationStatus(noteId, verificationData)` - Verification workflow
- [ ] Add JSONB field handling for note content
- [ ] Implement proper indexing for date-based queries

### Task 1.3: Department Integrations Repository
**File**: `server/repositories/department_integrations_repository.cjs`

#### Subtasks:
- [ ] Extend BaseRepository class
- [ ] Implement CRUD operations:
  - [ ] `createIntegration(integrationData)` - Insert new integration
  - [ ] `findIntegrationById(id)` - Retrieve single integration
  - [ ] `findIntegrationsByJourney(journeyId)` - Get all journey integrations
  - [ ] `findIntegrationsByType(patientId, integrationType)` - Type-based filtering
  - [ ] `updateIntegration(id, updateData)` - Update integration record
  - [ ] `updateIntegrationStatus(id, status, resultData)` - Status workflow
  - [ ] `deleteIntegration(id)` - Soft delete
- [ ] Department-specific queries:
  - [ ] `findPendingIntegrations()` - Get pending integrations
  - [ ] `findPendingIntegrationsByType(departmentType)` - Type-based pending
  - [ ] `findFailedIntegrations()` - Error recovery queries
  - [ ] `findCompletedIntegrationsByDateRange(startDate, endDate)` - Completed queries
- [ ] Batch operations:
  - [ ] `batchCreateIntegrations(integrationsArray)` - Bulk insert
  - [ ] `batchUpdateStatus(ids, status, resultData)` - Bulk updates
- [ ] Integration monitoring:
  - [ ] `getIntegrationStats()` - Aggregate statistics
  - [ ] `getIntegrationErrors()` - Error tracking
- [ ] Add proper indexing for status and type queries

### Task 1.4: Repository Testing & Validation
#### Subtasks:
- [ ] Create unit tests for InpatientJourneysRepository
- [ ] Create unit tests for DailyNotesRepository
- [ ] Create unit tests for DepartmentIntegrationsRepository
- [ ] Test transaction handling and rollback scenarios
- [ ] Test JSONB field handling
- [ ] Performance testing for large datasets
- [ ] Error handling and edge case validation

## Phase 2: Service Layer (Business Logic)

### Task 2.1: Inpatient Journey Service
**File**: `server/inpatient_journey_service.cjs`

#### Subtasks:
- [ ] Initialize service with repository dependencies
- [ ] Journey lifecycle management:
  - [ ] `admitPatient(admissionData)` - Create journey + encounter
  - [ ] `updateDailyProgress(journeyId, progressData)` - Progress updates
  - [ ] `dischargePatient(journeyId, dischargeData)` - Finalize journey
  - [ ] `transferPatient(journeyId, newLocationData)` - Location transfers
- [ ] Journey validation and business rules:
  - [ ] Validate admission data and constraints
  - [ ] Check for duplicate active admissions
  - [ ] Validate discharge conditions and requirements
  - [ ] Validate transfer eligibility and rules
- [ ] Journey statistics and reporting:
  - [ ] `getJourneySummary(journeyId)` - Summary data
  - [ ] `getJourneyAnalytics(journeyId)` - Analytics and insights
  - [ ] `getPatientJourneyHistory(patientId)` - Patient journey history
- [ ] Integration with other services:
  - [ ] Link to encounters service
  - [ ] Link to daily notes service
  - [ ] Link to department integrations
- [ ] Error handling and audit logging

### Task 2.2: Daily Notes Service
**File**: `server/daily_notes_service.cjs`

#### Subtasks:
- [ ] Initialize service with repository and voice dependencies
- [ ] Manual note creation:
  - [ ] `createDailyNoteManual(noteData)` - Manual note creation
  - [ ] `updateDailyNote(noteId, updates)` - Edit existing notes
  - [ ] `deleteDailyNote(noteId)` - Delete with validation
- [ ] Voice note creation:
  - [ ] `createDailyNoteVoice(audioData, noteData)` - Voice-based notes
  - [ ] `processVoiceTranscript(transcriptData, noteData)` - Process voice to text
  - [ ] `linkVoiceSession(noteId, sessionId)` - Link voice sessions
- [ ] Paper note digitization:
  - [ ] `createDailyNoteFromPaper(imageData, noteData)` - Paper to digital
  - [ ] `processExtractedContent(noteId, extractedData)` - Process AI extraction
  - [ ] `verifyExtractedContent(noteId, verifiedData, verifierId)` - Human verification
- [ ] Review and approval workflow:
  - [ ] `submitForReview(noteId, reviewerId)` - Submit for review
  - [ ] `approveDailyNote(noteId, reviewerId, feedback)` - Approval process
  - [ ] `rejectDailyNote(noteId, reviewerId, reason)` - Rejection with reason
  - [ ] `requestChanges(noteId, requesterId, changes)` - Request modifications
- [ ] Daily note queries and reporting:
  - [ ] `getDailyNotesTimeline(journeyId)` - Timeline view
  - [ ] `getDailyNotesSummary(journeyId)` - Summary statistics
  - [ ] `getNotesNeedingAttention()` - Quality control queries
- [ ] Integration with voice and AI services:
  - [ ] Integrate with live conversation service
  - [ ] Integrate with image extraction agents
  - [ ] Integrate with PHI masking service

### Task 2.3: Department Integration Service
**File**: `server/department_integration_service.cjs`

#### Subtasks:
- [ ] Initialize service with repository and interop dependencies
- [ ] Lab orders workflow:
  - [ ] `createLabOrder(orderData)` - Create lab orders
  - [ ] `updateLabOrder(orderId, updateData)` - Update orders
  - [ ] `cancelLabOrder(orderId)` - Cancel with validation
- [ ] Radiology orders workflow:
  - [ ] `createRadiologyOrder(orderData)` - Create radiology orders
  - [ ] `updateRadiologyOrder(orderId, updateData)` - Update orders
  - [ ] `cancelRadiologyOrder(orderId)` - Cancel with validation
- [ ] Results processing:
  - [ ] `processLabResults(resultsData)` - Process lab results
  - [ ] `processRadiologyResults(resultsData)` - Process radiology results
  - [ ] `linkResultsToDailyNote(resultId, noteId)` - Link to notes
- [ ] Import/export operations:
  - [ ] `exportPendingOrders(departmentType)` - Export pending orders
  - [ ] `importDepartmentResults(resultsData)` - Import results
  - [ ] `syncDepartmentData(departmentType)` - Sync with external systems
- [ ] Integration monitoring:
  - [ ] `getIntegrationStatus(journeyId)` - Status overview
  - [ ] `getIntegrationErrors()` - Error tracking and reporting
  - [ ] `retryFailedIntegrations()` - Retry failed operations
- [ ] Integration with external systems:
  - [ ] Integrate with InteropRepository
  - [ ] Handle HL7/FHIR message parsing
  - [ ] Handle external system errors and retries

### Task 2.4: Service Testing & Integration
#### Subtasks:
- [ ] Create unit tests for JourneyService
- [ ] Create unit tests for DailyNotesService  
- [ ] Create unit tests for DepartmentIntegrationService
- [ ] Create integration tests for service interactions
- [ ] Test business logic and validation rules
- [ ] Test error handling and rollback scenarios
- [ ] Performance testing for service operations

## Phase 3: API Routes (HTTP Endpoints)

### Task 3.1: Journey API Routes
**File**: `server/inpatient_journey_routes.cjs`

#### Subtasks:
- [ ] Setup route handlers and authentication
- [ ] Journey management endpoints:
  - [ ] `GET /api/journeys/:id` - Get single journey
  - [ ] `GET /api/journeys/patient/:patientId` - Get patient journeys
  - [ ] `GET /api/journeys/location/:locationId/active` - Get active admissions
  - [ ] `POST /api/journeys/admit` - Admit patient
  - [ ] `PUT /api/journeys/:id` - Update journey
  - [ ] `PUT /api/journeys/:id/status` - Update journey status
  - [ ] `POST /api/journeys/:id/discharge` - Discharge patient
  - [ ] `POST /api/journeys/:id/transfer` - Transfer patient
  - [ ] `GET /api/journeys/:id/summary` - Get journey summary
  - [ ] `GET /api/journeys/:id/analytics` - Get journey analytics
- [ ] Request validation and error handling:
  - [ ] Add request validation middleware
  - [ ] Implement proper error responses
  - [ ] Add input sanitization
- [ ] Response formatting:
  - [ ] Standardize response formats
  - [ ] Add pagination support
  - [ ] Add filtering and sorting options
- [ ] API documentation:
  - [ ] Add API route documentation
  - [ ] Add request/response examples

### Task 3.2: Daily Notes API Routes
**Subtasks:**
- [ ] Daily notes endpoints:
  - [ ] `GET /api/journeys/:journeyId/notes` - Get journey notes
  - [ ] `GET /api/journeys/:journeyId/notes/:noteId` - Get single note
  - [ ] `GET /api/journeys/:journeyId/notes/timeline` - Get notes timeline
  - [ ] `POST /api/journeys/:journeyId/notes` - Create manual note
  - [ ] `PUT /api/journeys/:journeyId/notes/:noteId` - Update note
  - [ ] `DELETE /api/journeys/:journeyId/notes/:noteId` - Delete note
  - [ ] `POST /api/journeys/:journeyId/notes/:noteId/voice` - Create voice note
  - [ ] `POST /api/journeys/:journeyId/notes/:noteId/submit-review` - Submit for review
  - [ ] `POST /api/journeys/:journeyId/notes/:noteId/approve` - Approve note
  - [ ] `POST /api/journeys/:journeyId/notes/:noteId/reject` - Reject note
  - [ ] `GET /api/journeys/:journeyId/notes/needs-attention` - Get notes needing attention
- [ ] Paper digitization endpoints:
  - [ ] `POST /api/journeys/:journeyId/notes/paper` - Create note from paper
  - [ ] `POST /api/journeys/:journeyId/notes/:noteId/verify` - Verify extracted content
  - [ ] `GET /api/journeys/:journeyId/notes/unverified` - Get unverified notes
- [ ] File upload handling:
  - [ ] Add audio file upload for voice notes
  - [ ] Add image file upload for paper notes
  - [ ] Implement file size and type validation
  - [ ] Handle multipart form data

### Task 3.3: Department Integration API Routes
**Subtasks:**
- [ ] Department integration endpoints:
  - [ ] `GET /api/journeys/:journeyId/integrations` - Get journey integrations
  - [ ] `GET /api/journeys/:journeyId/integrations/:id` - Get single integration
  - [ ] `POST /api/journeys/:journeyId/integrations/lab-orders` - Create lab order
  - [ ] `POST /api/journeys/:journeyId/integrations/radiology-orders` - Create radiology order
  - [ ] `PUT /api/journeys/:journeyId/integrations/:integrationId` - Update integration
  - [ ] `POST /api/department-integrations/lab-results` - Import lab results
  - [ ] `POST /api/department-integrations/radiology-results` - Import radiology results
  - [ ] `GET /api/department-integrations/pending/:departmentType` - Get pending integrations
  - [ ] `POST /api/department-integrations/export/:departmentType` - Export orders
  - [ ] `GET /api/department-integrations/status` - Get integration status
- [ ] Batch operations:
  - [ ] `POST /api/department-integrations/batch` - Batch create integrations
  - [ ] `PUT /api/department-integrations/batch/status` - Batch update status
- [ ] Sync operations:
  - [ ] `POST /api/department-integrations/sync/:departmentType` - Trigger sync

### Task 3.4: API Testing & Documentation
#### Subtasks:
- [ ] Create API integration tests
- [ ] Test authentication and authorization
- [ ] Test error handling and edge cases
- [ ] Test file upload functionality
- [ ] Performance testing for API endpoints
- [ ] Create comprehensive API documentation
- [ ] Add request/response examples

## Phase 4: Paper Digitization Services

### Task 4.1: Paper Digitization Service
**File**: `server/paper_digitization_service.cjs`

#### Subtasks:
- [ ] Initialize paper digitization service
- [ ] Photo capture workflow:
  - [ ] `capturePaperNote(imageData, journeyId, noteDate)` - Individual photo capture
  - [ ] `processPaperImage(imageData)` - Image preprocessing
  - [ ] `autoRotateImage(imageData)` - Auto-orientation correction
  - [ ] `enhanceImageQuality(imageData)` - Image quality enhancement
- [ ] Batch scanning workflow:
  - [ ] `uploadBatchPaperChart(imagesData, patientId)` - Batch upload processing
  - [ ] `parsePatientInfoFromDocuments(documents)` - Parse patient info
  - [ ] `sortDocumentsByDate(documents)` - Date-based sorting
  - [ ] `matchDocumentsToJourneys(documents)` - Journey matching
- [ ] AI integration:
  - [ ] Integrate with existing image extraction agents
  - [ ] Apply PHI masking before processing
  - [ ] Call handwriting extraction service
  - [ ] Process extraction results
- [ ] Human verification workflow:
  - [ ] `queueForVerification(noteId)` - Queue for human review
  - [ ] `getVerificationQueue()` - Get pending verifications
  - [ ] `processVerificationResult(noteId, result)` - Process verification
- [ ] Digitization tracking:
  - [ ] `getPaperDigitizationStats(journeyId)` - Track progress
  - [ ] `getDigitizationProgress(patientId)` - Overall progress
  - [ ] `updateDigitizationStatus(journeyId, status)` - Status updates

### Task 4.2: Handwriting Extraction Service  
**File**: `server/handwriting_extraction_service.cjs`

#### Subtasks:
- [ ] Initialize handwriting extraction service
- [ ] Integration with existing AI agents:
  - [ ] Connect to existing image extraction agents
  - [ ] Configure extraction parameters
  - [ ] Handle agent responses
- [ ] Handwriting processing:
  - [ ] `extractHandwriting(imageData)` - Main extraction method
  - [ ] `extractDailyNoteStructure(imageData)` - Extract SOAP format
  - [ ] `extractVitalsFromForm(imageData)` - Extract vitals from forms
  - [ ] `extractMedicationsFromOrder(imageData)` - Extract medication orders
  - [ ] `parseHandwrittenText(imageData)` - Parse handwritten text
- [ ] Data normalization:
  - [ ] `normalizeExtractedData(rawExtraction)` - Normalize to daily note format
  - [ ] `validateExtractedData(extractedData)` - Validate extracted content
  - [ ] `enrichExtractedData(extractedData)` - Add context and metadata
- [ ] Quality and confidence:
  - [ ] `calculateExtractionConfidence(extraction)` - Confidence scoring
  - [ ] `detectLowConfidenceSections(extraction)` - Flag uncertain sections
  - [ ] `generateExtractionReport(extraction)` - Detailed extraction report

### Task 4.3: Paper Digitization Routes
**File**: `server/paper_digitization_routes.cjs`

#### Subtasks:
- [ ] Paper digitization endpoints:
  - [ ] `POST /api/paper-digitization/capture` - Photo capture endpoint
  - [ ] `POST /api/paper-digitization/batch-upload` - Batch scanning endpoint
  - [ ] `POST /api/paper-digitization/extract` - Trigger extraction
  - [ ] `GET /api/paper-digitization/queue` - Get verification queue
  - [ ] `POST /api/paper-digitization/verify/:noteId` - Verify extracted content
  - [ ] `GET /api/paper-digitization/stats/:journeyId` - Get digitization stats
  - [ ] `GET /api/paper-digitization/progress/:patientId` - Get overall progress
- [ ] File handling:
  - [ ] Handle image file uploads
  - [ ] Support multiple image formats
  - [ ] Implement file validation
  - [ ] Handle batch file uploads
- [ ] Preview and review:
  - [ ] `GET /api/paper-digitization/preview/:noteId` - Get extraction preview
  - [ ] `GET /api/paper-digitization/original/:noteId` - Get original image

### Task 4.4: PHI Masking Integration
**Subtasks:**
- [ ] Integrate with existing PHI masking functionality
- [ ] Apply PHI masking to paper images before processing
- [ ] Configure masking levels and rules
- [ ] Audit trail for masking operations
- [ ] Handle masked content display in verification

### Task 4.5: Paper Digitization Testing
#### Subtasks:
- [ ] Unit tests for paper digitization service
- [ ] Unit tests for handwriting extraction service
- [ ] Integration tests for AI agent calls
- [ ] Test image preprocessing pipeline
- [ ] Test extraction accuracy with sample data
- [ ] Test verification workflow
- [ ] Performance testing for batch operations

## Phase 5: Voice Integration Enhancement

### Task 5.1: Daily Notes Voice Processor
**File**: `server/daily_notes_voice_processor.cjs`

#### Subtasks:
- [ ] Extend existing live conversation infrastructure
- [ ] Real-time voice processing:
  - [ ] Initialize real-time voice session for daily notes
  - [ ] Process audio chunks with existing STT
  - [ ] Handle live transcript generation
  - [ ] Apply real-time PHI masking
- [ ] Batch voice processing:
  - [ ] Process uploaded audio files
  - [ ] Integrate with existing STT service
  - [ ] Handle batch transcription
- [ ] Daily note extraction:
  - [ ] Extract SOAP structure from transcripts
  - [ ] Parse medical context from voice
  - [ ] Handle medical terminology and abbreviations
- [ ] Integration with existing voice infrastructure:
  - [ ] Extend LiveConversationWebSocket
  - [ ] Link voice sessions to daily notes
  - [ ] Handle voice-to-text errors and retries

### Task 5.2: Daily Note Extraction Skill
**File**: `skills/daily_note_extraction_skill.cjs`

#### Subtasks:
- [ ] Create daily note extraction skill following existing patterns
- [ ] SOAP structure extraction:
  - [ ] Extract subjective section
  - [ ] Extract objective section  
  - [ ] Extract assessment section
  - [ ] Extract plan section
- [ ] Medical context understanding:
  - [ ] Parse medical terminology
  - [ ] Handle abbreviations and shorthand
  - [ ] Extract vitals and medications
- [ ] PHI masking integration:
  - [ ] Apply PHI masking to transcripts
  - [ ] Handle masked content in extraction
  - [ ] Maintain audit trail

### Task 5.3: Voice Integration Testing
#### Subtasks:
- [ ] Test real-time voice processing
- [ ] Test batch voice upload
- [ ] Test extraction accuracy
- [ ] Test PHI masking in voice pipeline
- [ ] Integration testing with STT agents
- [ ] Performance testing for voice processing

## Phase 7: Department Integration Workflows

### Task 7.1: Department Integration Batch Service
**File**: `server/department_integration_batch_service.cjs`

#### Subtasks:
- [ ] Initialize batch processing service
- [ ] Batch import operations:
  - [ ] `batchImportLabResults(resultsArray)` - Import multiple lab results
  - [ ] `batchImportRadiologyResults(resultsArray)` - Import multiple radiology results
  - [ ] `processImportBatch(batchId)` - Process import batch
- [ ] Batch export operations:
  - [ ] `batchExportLabOrders(filters)` - Export pending lab orders
  - [ ] `batchExportRadiologyOrders(filters)` - Export pending radiology orders
  - [ ] `processExportBatch(batchId)` - Process export batch
- [ ] Batch processing:
  - [ ] Implement queue-based batch processing
  - [ ] Handle batch errors and retries
  - [ ] Batch status tracking
- [ ] Integration with external systems:
  - [ ] Handle HL7/FHIR message generation
  - [ ] Handle external system communication
  - [ ] Error handling and retry logic

### Task 7.2: Department Sync Scripts
**Files**: `scripts/department_sync_*.cjs`

#### Subtasks:
- [ ] Lab results sync script:
  - [ ] `scripts/department_sync_lab_results.cjs`
  - [ ] Fetch pending lab results from external system
  - [ ] Parse HL7/FHIR messages
  - [ ] Normalize data to internal format
  - [ ] Update database records
- [ ] Radiology results sync script:
  - [ ] `scripts/department_sync_radiology_results.cjs`
  - [ ] Similar workflow for radiology results
  - [ ] Handle image references
- [ ] Orders export script:
  - [ ] `scripts/department_export_orders.cjs`
  - [ ] Collect pending orders
  - [ ] Generate HL7/FHIR messages
  - [ ] Send to external systems
- [ ] Scheduled sync setup:
  - [ ] Configure cron jobs for regular sync
  - [ ] Error handling and logging
  - [ ] Monitoring and alerting

### Task 7.3: Department Integration Testing
#### Subtasks:
- [ ] Test batch import operations
- [ ] Test batch export operations
- [ ] Test HL7/FHIR parsing
- [ ] Test scheduled sync scripts
- [ ] Test error handling and retry logic
- [ ] Integration testing with external systems

## Backend Integration & Testing Tasks

### Task: Cross-Service Integration
#### Subtasks:
- [ ] Integrate journey service with daily notes service
- [ ] Integrate daily notes with voice processing
- [ ] Integrate paper digitization with daily notes
- [ ] Integrate department services with journeys
- [ ] Test end-to-end workflows
- [ ] Test error scenarios and rollback

### Task: Performance Optimization
#### Subtasks:
- [ ] Database query optimization
- [ ] Add proper indexes
- [ ] Implement caching where appropriate
- [ ] Optimize file upload handling
- [ ] Load testing for API endpoints
- [ ] Memory usage optimization

### Task: Security & Compliance
#### Subtasks:
- [ ] Implement PHI/PII masking throughout pipeline
- [ ] Add audit logging for sensitive operations
- [ ] Implement data retention policies
- [ ] Add access control validation
- [ ] Security testing and vulnerability scanning

### Task: Deployment & Monitoring
#### Subtasks:
- [ ] Prepare deployment configuration
- [ ] Setup monitoring and alerting
- [ ] Configure logging and error tracking
- [ ] Create deployment scripts
- [ ] Test deployment process
- [ ] Create runbook for operations