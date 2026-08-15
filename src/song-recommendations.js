import { supabase } from './supabase.js'
import {
  captureCommentDrafts,
  createCommentsSection,
  getCommentDraftKey,
  groupCommentsByTarget,
  loadComments,
  loadRecentComments,
  renderRecentComments,
  revealCommentTarget
} from './comments.js'
import {
  createIlikeFilterValue,
  renderPagination
} from './list-navigation.js'

const RECOMMENDATION_STATUSES = [
  { value: 'recommended', label: '추천 중' },
  { value: 'candidate', label: '합주 후보' },
  { value: 'confirmed', label: '합주 확정' },
  { value: 'hold', label: '보류' }
]
const RECOMMENDATIONS_PER_PAGE = 10

let boardState = null
let recommendationsById = new Map()
let editingRecommendationId = null
let hasLoadedRecommendations = false
let recommendationListPage = 1
let recommendationListSearch = ''
let recommendationStatusFilter = 'all'
let recommendationListRequestId = 0

function getStatusLabel(status) {
  return (
    RECOMMENDATION_STATUSES.find(
      (option) => option.value === status
    )?.label ?? '추천 중'
  )
}

function formatRecommendationDate(dateValue) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateValue))
}

function normalizeYouTubeUrl(value) {
  const trimmedValue = value.trim()
  const urlValue = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`

  let url

  try {
    url = new URL(urlValue)
  } catch {
    throw new Error('올바른 YouTube 주소를 입력해주세요.')
  }

  const hostname = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')

  const isYouTubeHost =
    hostname === 'youtu.be' ||
    hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com')

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !isYouTubeHost
  ) {
    throw new Error('YouTube 영상 주소만 등록할 수 있습니다.')
  }

  url.protocol = 'https:'
  return url.toString()
}

function showRecommendationMessage(
  message,
  isError = false
) {
  const messageElement = document.querySelector(
    '#recommendationFormMessage'
  )

  if (!messageElement) {
    return
  }

  messageElement.textContent = message
  messageElement.classList.toggle(
    'error-message',
    isError
  )
}

function resetRecommendationForm() {
  const form = document.querySelector(
    '#songRecommendationForm'
  )

  if (!form) {
    return
  }

  form.reset()
  editingRecommendationId = null

  document.querySelector(
    '#recommendationFormTitle'
  ).textContent = '새 곡 추천하기'

  document.querySelector(
    '#saveRecommendationButton'
  ).textContent = '추천곡 올리기'

  document.querySelector(
    '#cancelRecommendationEditButton'
  ).hidden = true
}

function startRecommendationEdit(recommendation) {
  const form = document.querySelector(
    '#songRecommendationForm'
  )

  if (!form) {
    return
  }

  editingRecommendationId = recommendation.id
  form.elements.title.value = recommendation.title
  form.elements.artist.value = recommendation.artist
  form.elements.youtubeUrl.value =
    recommendation.youtube_url
  form.elements.reason.value = recommendation.reason

  document.querySelector(
    '#recommendationFormTitle'
  ).textContent = '추천곡 수정하기'

  document.querySelector(
    '#saveRecommendationButton'
  ).textContent = '수정 내용 저장'

  document.querySelector(
    '#cancelRecommendationEditButton'
  ).hidden = false

  showRecommendationMessage('')
  form.scrollIntoView({ behavior: 'smooth', block: 'start' })
  form.elements.title.focus({ preventScroll: true })
}

async function handleRecommendationSubmit(event) {
  event.preventDefault()

  const state = boardState
  const form = event.currentTarget
  const saveButton = document.querySelector(
    '#saveRecommendationButton'
  )

  if (!state || !saveButton) {
    return
  }

  const title = form.elements.title.value.trim()
  const artist = form.elements.artist.value.trim()
  const reason = form.elements.reason.value.trim()

  let youtubeUrl

  try {
    youtubeUrl = normalizeYouTubeUrl(
      form.elements.youtubeUrl.value
    )
  } catch (error) {
    showRecommendationMessage(error.message, true)
    return
  }

  if (!title || !artist || !reason) {
    showRecommendationMessage(
      '곡명, 아티스트, 추천 이유를 모두 입력해주세요.',
      true
    )
    return
  }

  saveButton.disabled = true
  showRecommendationMessage('저장하고 있습니다.')

  const recommendationValues = {
    title,
    artist,
    youtube_url: youtubeUrl,
    reason
  }

  const result = editingRecommendationId
    ? await supabase
        .from('song_recommendations')
        .update(recommendationValues)
        .eq('id', editingRecommendationId)
    : await supabase
        .from('song_recommendations')
        .insert({
          ...recommendationValues,
          created_by: state.session.user.id
        })

  if (boardState !== state) {
    return
  }

  if (result.error) {
    console.error(result.error)
    showRecommendationMessage(
      `추천곡 저장 실패: ${result.error.message}`,
      true
    )
    saveButton.disabled = false
    return
  }

  const successMessage = editingRecommendationId
    ? '추천곡이 수정됐습니다.'
    : '추천곡이 등록됐습니다.'

  resetRecommendationForm()
  saveButton.disabled = false
  showRecommendationMessage(successMessage)
  await refreshSongRecommendations(true)
}

async function handleRecommendationDelete(recommendation) {
  const confirmed = window.confirm(
    `"${recommendation.title}" 추천을 삭제할까요?`
  )

  if (!confirmed) {
    return
  }

  const { error } = await supabase
    .from('song_recommendations')
    .delete()
    .eq('id', recommendation.id)

  if (error) {
    console.error(error)
    alert(`추천곡 삭제 실패: ${error.message}`)
    return
  }

  if (editingRecommendationId === recommendation.id) {
    resetRecommendationForm()
    showRecommendationMessage('')
  }

  await refreshSongRecommendations(true)
}

async function handleRecommendationVote(
  recommendation,
  hasMyVote,
  button
) {
  const state = boardState

  if (!state) {
    return
  }

  button.disabled = true

  const query = supabase.from('song_recommendation_votes')
  const result = hasMyVote
    ? await query
        .delete()
        .eq('recommendation_id', recommendation.id)
        .eq('user_id', state.session.user.id)
    : await query.insert({
        recommendation_id: recommendation.id,
        user_id: state.session.user.id
      })

  if (boardState !== state) {
    return
  }

  if (result.error) {
    console.error(result.error)
    alert(`투표 변경 실패: ${result.error.message}`)
    button.disabled = false
    return
  }

  await refreshSongRecommendations(true)
}

async function handleRecommendationStatusChange(
  recommendation,
  select
) {
  const previousStatus = recommendation.status
  select.disabled = true

  const { error } = await supabase
    .from('song_recommendations')
    .update({ status: select.value })
    .eq('id', recommendation.id)

  if (error) {
    console.error(error)
    select.value = previousStatus
    select.disabled = false
    alert(`추천 상태 변경 실패: ${error.message}`)
    return
  }

  await refreshSongRecommendations(true)
}

function createRecommendationCard(
  recommendation,
  votes,
  comments,
  membersByUserId,
  initialCommentDraft
) {
  const state = boardState
  const card = document.createElement('article')
  card.className =
    `recommendation-card status-${recommendation.status}`
  card.id = `recommendation-${recommendation.id}`

  const cardHeader = document.createElement('div')
  cardHeader.className = 'recommendation-card-header'

  const titleGroup = document.createElement('div')
  titleGroup.className = 'recommendation-title-group'

  const title = document.createElement('h3')
  title.textContent = recommendation.title

  const artist = document.createElement('p')
  artist.className = 'recommendation-artist'
  artist.textContent = recommendation.artist

  titleGroup.append(title, artist)

  const statusBadge = document.createElement('span')
  statusBadge.className = 'recommendation-status-badge'
  statusBadge.textContent = getStatusLabel(
    recommendation.status
  )

  cardHeader.append(titleGroup, statusBadge)

  const reason = document.createElement('p')
  reason.className = 'recommendation-reason'
  reason.textContent = recommendation.reason

  const recommender = membersByUserId.get(
    recommendation.created_by
  )

  const meta = document.createElement('p')
  meta.className = 'recommendation-meta'
  meta.textContent =
    `추천자: ${recommender?.display_name ?? '밴드원'} · ` +
    formatRecommendationDate(recommendation.created_at)

  const footer = document.createElement('div')
  footer.className = 'recommendation-card-footer'

  const primaryActions = document.createElement('div')
  primaryActions.className = 'recommendation-primary-actions'

  const youtubeLink = document.createElement('a')
  youtubeLink.className = 'youtube-link'
  youtubeLink.href = recommendation.youtube_url
  youtubeLink.target = '_blank'
  youtubeLink.rel = 'noopener noreferrer'
  youtubeLink.textContent = 'YouTube에서 듣기'

  const recommendationVotes = votes.filter(
    (vote) =>
      vote.recommendation_id === recommendation.id
  )

  const hasMyVote = recommendationVotes.some(
    (vote) => vote.user_id === state.session.user.id
  )

  const voterNames = recommendationVotes
    .map(
      (vote) =>
        membersByUserId.get(vote.user_id)?.display_name ??
        '이름 미등록 멤버'
    )
    .sort((firstName, secondName) =>
      firstName.localeCompare(secondName, 'ko')
    )

  const voterNamesText = voterNames.length > 0
    ? `투표한 멤버: ${voterNames.join(', ')}`
    : '아직 투표한 멤버가 없습니다.'

  const voteButton = document.createElement('button')
  voteButton.className = 'recommendation-vote-button'
  voteButton.classList.toggle('is-voted', hasMyVote)
  voteButton.type = 'button'
  voteButton.textContent =
    `${hasMyVote ? '✓ ' : ''}합주해 보고 싶어요 ` +
    `${recommendationVotes.length}명`
  voteButton.title = voterNamesText
  voteButton.setAttribute(
    'aria-label',
    `${voteButton.textContent}. ${voterNamesText}`
  )
  voteButton.addEventListener('click', () => {
    void handleRecommendationVote(
      recommendation,
      hasMyVote,
      voteButton
    )
  })

  primaryActions.append(youtubeLink, voteButton)
  footer.append(primaryActions)

  const canManageRecommendation =
    state.currentMember.role === 'admin' ||
    recommendation.created_by === state.session.user.id

  if (
    canManageRecommendation ||
    state.currentMember.role === 'admin'
  ) {
    const managementActions = document.createElement('div')
    managementActions.className =
      'recommendation-management-actions'

    if (state.currentMember.role === 'admin') {
      const statusSelect = document.createElement('select')
      statusSelect.className = 'recommendation-status-select'
      statusSelect.setAttribute(
        'aria-label',
        `${recommendation.title} 추천 상태`
      )

      RECOMMENDATION_STATUSES.forEach((status) => {
        const option = document.createElement('option')
        option.value = status.value
        option.textContent = status.label
        statusSelect.append(option)
      })

      statusSelect.value = recommendation.status
      statusSelect.addEventListener('change', () => {
        void handleRecommendationStatusChange(
          recommendation,
          statusSelect
        )
      })

      managementActions.append(statusSelect)
    }

    if (canManageRecommendation) {
      const editButton = document.createElement('button')
      editButton.className =
        'recommendation-management-button edit-recommendation-button'
      editButton.type = 'button'
      editButton.textContent = '수정'
      editButton.addEventListener('click', () => {
        startRecommendationEdit(recommendation)
      })

      const deleteButton = document.createElement('button')
      deleteButton.className =
        'recommendation-management-button delete-recommendation-button'
      deleteButton.type = 'button'
      deleteButton.textContent = '삭제'
      deleteButton.addEventListener('click', () => {
        void handleRecommendationDelete(recommendation)
      })

      managementActions.append(editButton, deleteButton)
    }

    footer.append(managementActions)
  }

  const commentsSection = createCommentsSection({
    targetType: 'recommendation',
    targetId: recommendation.id,
    comments,
    membersByUserId,
    currentUserId: state.session.user.id,
    isAdmin: state.currentMember.role === 'admin',
    initialDraft: initialCommentDraft
  })

  card.append(
    cardHeader,
    reason,
    meta,
    footer,
    commentsSection
  )
  return card
}

function getRecommendationPageQuery() {
  const firstRow =
    (recommendationListPage - 1) * RECOMMENDATIONS_PER_PAGE
  const lastRow = firstRow + RECOMMENDATIONS_PER_PAGE - 1

  let query = supabase
    .from('song_recommendations')
    .select(`
      id,
      title,
      artist,
      youtube_url,
      reason,
      status,
      created_by,
      created_at,
      updated_at
    `, { count: 'exact' })

  if (recommendationListSearch) {
    const ilikeValue = createIlikeFilterValue(
      recommendationListSearch
    )
    const normalizedSearch =
      recommendationListSearch.toLocaleLowerCase('ko-KR')
    const matchingUserIds = boardState.members
      .filter((member) =>
        member.display_name
          .toLocaleLowerCase('ko-KR')
          .includes(normalizedSearch)
      )
      .map((member) => member.user_id)
      .filter(Boolean)

    const filters = []

    if (ilikeValue) {
      filters.push(
        `title.ilike.${ilikeValue}`,
        `artist.ilike.${ilikeValue}`
      )
    }

    if (matchingUserIds.length > 0) {
      filters.push(
        `created_by.in.(${matchingUserIds.join(',')})`
      )
    }

    if (filters.length > 0) {
      query = query.or(filters.join(','))
    }
  }

  if (recommendationStatusFilter !== 'all') {
    query = query.eq('status', recommendationStatusFilter)
  }

  return query
    .order('created_at', { ascending: false })
    .range(firstRow, lastRow)
}

async function loadRecommendationListData() {
  let recommendationsResult =
    await getRecommendationPageQuery()

  if (recommendationsResult.error) {
    throw recommendationsResult.error
  }

  const totalCount = recommendationsResult.count ?? 0
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / RECOMMENDATIONS_PER_PAGE)
  )

  if (recommendationListPage > totalPages) {
    recommendationListPage = totalPages
    recommendationsResult = await getRecommendationPageQuery()

    if (recommendationsResult.error) {
      throw recommendationsResult.error
    }
  }

  const recommendationIds = recommendationsResult.data.map(
    (recommendation) => recommendation.id
  )

  const votesPromise = recommendationIds.length > 0
    ? supabase
        .from('song_recommendation_votes')
        .select(`
          recommendation_id,
          user_id
        `)
        .in('recommendation_id', recommendationIds)
    : Promise.resolve({ data: [], error: null })

  const [votesResult, commentsResult] = await Promise.all([
    votesPromise,
    loadComments('recommendation', recommendationIds)
  ])

  const error = votesResult.error ?? commentsResult.error

  if (error) {
    throw error
  }

  return {
    recommendations: recommendationsResult.data,
    votes: votesResult.data,
    comments: commentsResult.data,
    totalCount
  }
}

async function loadRecentRecommendationCommentsData() {
  const commentsResult = await loadRecentComments(
    'recommendation'
  )

  if (commentsResult.error) {
    throw commentsResult.error
  }

  const recommendationIds = [
    ...new Set(
      commentsResult.data.map(
        (comment) => comment.recommendation_id
      )
    )
  ]

  const recommendationsResult = recommendationIds.length > 0
    ? await supabase
        .from('song_recommendations')
        .select('id, title, artist, created_at')
        .in('id', recommendationIds)
    : { data: [], error: null }

  if (recommendationsResult.error) {
    throw recommendationsResult.error
  }

  return {
    comments: commentsResult.data,
    recommendations: recommendationsResult.data ?? []
  }
}

async function getRecommendationPage(recommendationId) {
  const { data: recommendation, error } = await supabase
    .from('song_recommendations')
    .select('id, created_at')
    .eq('id', recommendationId)
    .maybeSingle()

  if (error) {
    throw error
  }

  if (!recommendation) {
    return null
  }

  const { count, error: countError } = await supabase
    .from('song_recommendations')
    .select('id', { count: 'exact', head: true })
    .gt('created_at', recommendation.created_at)

  if (countError) {
    throw countError
  }

  return Math.floor(
    (count ?? 0) / RECOMMENDATIONS_PER_PAGE
  ) + 1
}

async function showRecommendationFromComment(
  recommendationId
) {
  try {
    const targetPage = await getRecommendationPage(
      recommendationId
    )

    if (!targetPage) {
      window.alert('해당 추천곡을 찾을 수 없습니다.')
      return
    }

    recommendationListSearch = ''
    recommendationStatusFilter = 'all'
    recommendationListPage = targetPage
    await refreshSongRecommendations(true)

    const target = document.getElementById(
      `recommendation-${recommendationId}`
    )

    if (!revealCommentTarget(target)) {
      window.alert('해당 추천곡을 찾을 수 없습니다.')
    }
  } catch (error) {
    console.error(error)
    window.alert(
      `추천곡으로 이동하지 못했습니다: ${error.message}`
    )
  }
}

function renderRecentRecommendationComments({
  comments,
  recommendations,
  error
}) {
  if (!boardState) {
    return
  }

  const recommendationsByCommentTarget = new Map(
    recommendations.map((recommendation) => [
      recommendation.id,
      recommendation
    ])
  )
  const membersByUserId = new Map(
    boardState.members
      .filter((member) => member.user_id)
      .map((member) => [member.user_id, member])
  )

  renderRecentComments({
    container: document.querySelector(
      '#recommendationRecentCommentsList'
    ),
    targetType: 'recommendation',
    comments,
    membersByUserId,
    error,
    getTargetLabel: (comment) => {
      const recommendation =
        recommendationsByCommentTarget.get(
          comment.recommendation_id
        )

      return recommendation
        ? `${recommendation.title} · ${recommendation.artist}`
        : '삭제된 추천곡'
    },
    onSelect: showRecommendationFromComment
  })
}

function renderRecommendationListControls(totalCount) {
  const searchInput = document.querySelector(
    '#recommendationSearchInput'
  )
  const statusSelect = document.querySelector(
    '#recommendationStatusFilter'
  )
  const resetButton = document.querySelector(
    '#resetRecommendationFiltersButton'
  )
  const summary = document.querySelector(
    '#recommendationListSummary'
  )
  const pagination = document.querySelector(
    '#recommendationPagination'
  )

  if (
    !searchInput ||
    !statusSelect ||
    !resetButton ||
    !summary ||
    !pagination
  ) {
    return
  }

  if (document.activeElement !== searchInput) {
    searchInput.value = recommendationListSearch
  }

  if (document.activeElement !== statusSelect) {
    statusSelect.value = recommendationStatusFilter
  }

  resetButton.hidden =
    !recommendationListSearch &&
    recommendationStatusFilter === 'all'

  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / RECOMMENDATIONS_PER_PAGE)
  )
  const hasFilters =
    recommendationListSearch ||
    recommendationStatusFilter !== 'all'
  const countLabel = hasFilters
    ? `검색 결과 ${totalCount}개`
    : `전체 ${totalCount}개`

  summary.textContent = totalCount > 0
    ? `${countLabel} · ${recommendationListPage}/${totalPages} 페이지`
    : countLabel

  renderPagination({
    container: pagination,
    currentPage: recommendationListPage,
    totalCount,
    pageSize: RECOMMENDATIONS_PER_PAGE,
    onPageChange: (page) => {
      if (page === recommendationListPage) {
        return
      }

      recommendationListPage = page
      void refreshSongRecommendations(true).then(() => {
        document
          .querySelector('#recommendationListSection')
          ?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          })
      })
    }
  })
}

function attachRecommendationListControls() {
  const form = document.querySelector(
    '#recommendationSearchForm'
  )
  const searchInput = document.querySelector(
    '#recommendationSearchInput'
  )
  const statusSelect = document.querySelector(
    '#recommendationStatusFilter'
  )
  const resetButton = document.querySelector(
    '#resetRecommendationFiltersButton'
  )

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    recommendationListSearch = searchInput.value.trim()
    recommendationStatusFilter = statusSelect.value
    recommendationListPage = 1
    void refreshSongRecommendations(true)
  })

  statusSelect.addEventListener('change', () => {
    recommendationListSearch = searchInput.value.trim()
    recommendationStatusFilter = statusSelect.value
    recommendationListPage = 1
    void refreshSongRecommendations(true)
  })

  resetButton.addEventListener('click', () => {
    searchInput.value = ''
    statusSelect.value = 'all'
    recommendationListSearch = ''
    recommendationStatusFilter = 'all'
    recommendationListPage = 1
    void refreshSongRecommendations(true)
  })
}

function renderRecommendationList(
  recommendations,
  votes,
  comments
) {
  const list = document.querySelector('#recommendationList')

  if (!list || !boardState) {
    return
  }

  const commentDrafts = captureCommentDrafts(list)
  list.replaceChildren()

  if (recommendations.length === 0) {
    const emptyMessage = document.createElement('p')
    emptyMessage.className = 'empty-message'
    const hasFilters =
      recommendationListSearch ||
      recommendationStatusFilter !== 'all'

    emptyMessage.textContent = hasFilters
      ? '검색 조건에 맞는 추천곡이 없습니다.'
      : '아직 추천된 곡이 없습니다. 첫 곡을 추천해보세요.'
    list.append(emptyMessage)
    return
  }

  const membersByUserId = new Map(
    boardState.members
      .filter((member) => member.user_id)
      .map((member) => [member.user_id, member])
  )

  const commentsByRecommendationId =
    groupCommentsByTarget(
      comments,
      'recommendation_id'
    )

  const fragment = document.createDocumentFragment()

  recommendations.forEach((recommendation) => {
    fragment.append(
      createRecommendationCard(
        recommendation,
        votes,
        commentsByRecommendationId.get(
          recommendation.id
        ) ?? [],
        membersByUserId,
        commentDrafts.get(
          getCommentDraftKey(
            'recommendation',
            recommendation.id
          )
        ) ?? ''
      )
    )
  })

  list.append(fragment)
}

export function mountSongRecommendations({
  session,
  currentMember,
  members
}) {
  const container = document.querySelector(
    '#songRecommendationsView'
  )

  if (!container) {
    return
  }

  boardState = {
    session,
    currentMember,
    members
  }
  recommendationsById = new Map()
  editingRecommendationId = null
  hasLoadedRecommendations = false

  container.innerHTML = `
    <section class="recommendation-intro">
      <h2>곡 추천</h2>
      <p>
        함께 합주해 보고 싶은 곡을 추천하고
        멤버들의 의견을 모아보세요.
      </p>
    </section>

    <section class="recommendation-form-section">
      <h2 id="recommendationFormTitle">
        새 곡 추천하기
      </h2>

      <form
        id="songRecommendationForm"
        class="recommendation-form"
      >
        <div class="recommendation-form-row">
          <div class="form-group">
            <label for="recommendationTitle">곡명</label>
            <input
              id="recommendationTitle"
              name="title"
              type="text"
              maxlength="200"
              required
            >
          </div>

          <div class="form-group">
            <label for="recommendationArtist">
              아티스트
            </label>
            <input
              id="recommendationArtist"
              name="artist"
              type="text"
              maxlength="200"
              required
            >
          </div>
        </div>

        <div class="form-group">
          <label for="recommendationYoutubeUrl">
            YouTube 주소
          </label>
          <input
            id="recommendationYoutubeUrl"
            name="youtubeUrl"
            type="text"
            inputmode="url"
            maxlength="500"
            placeholder="https://youtu.be/..."
            required
          >
        </div>

        <div class="form-group">
          <label for="recommendationReason">
            추천 이유
          </label>
          <textarea
            id="recommendationReason"
            name="reason"
            rows="3"
            maxlength="2000"
            placeholder="합주해 보고 싶은 이유를 남겨주세요."
            required
          ></textarea>
        </div>

        <div class="recommendation-form-actions">
          <button
            id="saveRecommendationButton"
            class="save-button"
            type="submit"
          >
            추천곡 올리기
          </button>

          <button
            id="cancelRecommendationEditButton"
            class="cancel-edit-button"
            type="button"
            hidden
          >
            수정 취소
          </button>
        </div>

        <p
          id="recommendationFormMessage"
          class="form-message"
          aria-live="polite"
        ></p>
      </form>
    </section>

    <section
      class="recent-comments-section"
      aria-labelledby="recommendationRecentCommentsTitle"
    >
      <div class="recent-comments-heading">
        <h2 id="recommendationRecentCommentsTitle">최근 댓글</h2>
        <span>최신 5개</span>
      </div>
      <div
        id="recommendationRecentCommentsList"
        class="recent-comments-list"
      >
        <p class="recent-comments-empty">
          최근 댓글을 불러오고 있습니다.
        </p>
      </div>
    </section>

    <section
      id="recommendationListSection"
      class="recommendation-list-section"
    >
      <h2>추천곡 목록</h2>

      <form
        id="recommendationSearchForm"
        class="list-search-form recommendation-search-form"
        role="search"
      >
        <label
          class="visually-hidden"
          for="recommendationSearchInput"
        >
          추천곡 검색
        </label>
        <input
          id="recommendationSearchInput"
          class="list-search-input"
          type="search"
          maxlength="100"
          placeholder="곡명·아티스트·추천자 검색"
        >

        <label
          class="visually-hidden"
          for="recommendationStatusFilter"
        >
          추천 상태
        </label>
        <select
          id="recommendationStatusFilter"
          class="list-filter-select"
        >
          <option value="all">전체 상태</option>
          ${RECOMMENDATION_STATUSES.map(
            (status) => `
              <option value="${status.value}">
                ${status.label}
              </option>
            `
          ).join('')}
        </select>

        <button
          class="list-search-button"
          type="submit"
        >
          검색
        </button>
        <button
          id="resetRecommendationFiltersButton"
          class="list-clear-button"
          type="button"
          hidden
        >
          초기화
        </button>
      </form>

      <p
        id="recommendationListSummary"
        class="list-result-summary"
        aria-live="polite"
      ></p>
      <div
        id="recommendationList"
        class="recommendation-list"
        aria-live="polite"
      >
        <p class="empty-message">
          추천곡을 불러오고 있습니다.
        </p>
      </div>
      <nav
        id="recommendationPagination"
        class="pagination"
        aria-label="추천곡 페이지"
        hidden
      ></nav>
    </section>
  `

  document
    .querySelector('#songRecommendationForm')
    .addEventListener('submit', (event) => {
      void handleRecommendationSubmit(event)
    })

  document
    .querySelector('#cancelRecommendationEditButton')
    .addEventListener('click', () => {
      resetRecommendationForm()
      showRecommendationMessage('')
    })

  attachRecommendationListControls()
}

export async function showSongRecommendations() {
  if (hasLoadedRecommendations) {
    return
  }

  await refreshSongRecommendations(true)
}

export async function refreshSongRecommendations(
  force = false
) {
  const state = boardState
  const list = document.querySelector('#recommendationList')
  const summary = document.querySelector(
    '#recommendationListSummary'
  )

  if (
    !state ||
    !list ||
    (!force && !hasLoadedRecommendations)
  ) {
    return
  }

  if (!hasLoadedRecommendations) {
    list.innerHTML = `
      <p class="empty-message">
        추천곡을 불러오고 있습니다.
      </p>
    `
  }

  if (summary) {
    summary.textContent = '목록을 불러오고 있습니다.'
  }

  const requestId = ++recommendationListRequestId
  let listData
  let recentCommentsData

  try {
    [listData, recentCommentsData] = await Promise.all([
      loadRecommendationListData(),
      loadRecentRecommendationCommentsData().catch((error) => {
        console.error('최근 추천곡 댓글 조회 실패:', error)
        return {
          comments: [],
          recommendations: [],
          error
        }
      })
    ])
  } catch (error) {
    console.error(error)

    if (
      boardState !== state ||
      requestId !== recommendationListRequestId
    ) {
      return
    }

    list.innerHTML = ''

    const errorMessage = document.createElement('p')
    errorMessage.className = 'empty-message error-message'
    errorMessage.textContent =
      '추천곡을 불러오지 못했습니다. ' +
      '잠시 후 다시 시도해주세요.'
    list.append(errorMessage)

    if (summary) {
      summary.textContent = ''
    }
    return
  }

  if (
    boardState !== state ||
    requestId !== recommendationListRequestId
  ) {
    return
  }

  hasLoadedRecommendations = true
  recommendationsById = new Map(
    listData.recommendations.map((recommendation) => [
      recommendation.id,
      recommendation
    ])
  )

  if (
    editingRecommendationId &&
    !recommendationsById.has(editingRecommendationId)
  ) {
    resetRecommendationForm()
    showRecommendationMessage('')
  }

  renderRecommendationList(
    listData.recommendations,
    listData.votes,
    listData.comments
  )
  renderRecentRecommendationComments(recentCommentsData)
  renderRecommendationListControls(listData.totalCount)
}

export function unmountSongRecommendations() {
  recommendationListRequestId += 1
  boardState = null
  recommendationsById = new Map()
  editingRecommendationId = null
  hasLoadedRecommendations = false
}
