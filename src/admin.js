import { supabase } from './supabase.js'

function getNextSortOrder(items) {
  const highestSortOrder = items.reduce(
    (highest, item) =>
      Math.max(highest, Number(item.sort_order) || 0),
    0
  )

  return highestSortOrder + 1
}

async function handleAddMember(
  event,
  members,
  refresh
) {
  event.preventDefault()

  const form = event.currentTarget
  const submitButton = form.querySelector('button')
  const displayName =
    form.elements.displayName.value.trim()
  const part = form.elements.part.value.trim()

  if (!displayName || !part) {
    alert('멤버 이름과 파트를 모두 입력해주세요.')
    return
  }

  submitButton.disabled = true

  const { error } = await supabase
    .from('band_members')
    .insert({
      display_name: displayName,
      part,
      role: 'member',
      is_approved: false,
      is_active: true,
      sort_order: getNextSortOrder(members)
    })

  if (error) {
    console.error(error)
    alert(`멤버 추가 실패: ${error.message}`)
    submitButton.disabled = false
    return
  }

  await refresh()
}

async function handleAddCategory(
  event,
  categories,
  refresh
) {
  event.preventDefault()

  const form = event.currentTarget
  const submitButton = form.querySelector('button')
  const name =
    form.elements.categoryName.value.trim()
  const color = form.elements.categoryColor.value

  if (!name) {
    alert('카테고리 이름을 입력해주세요.')
    return
  }

  submitButton.disabled = true

  const { error } = await supabase
    .from('practice_categories')
    .insert({
      name,
      color,
      is_active: true,
      sort_order: getNextSortOrder(categories)
    })

  if (error) {
    console.error(error)
    alert(`카테고리 추가 실패: ${error.message}`)
    submitButton.disabled = false
    return
  }

  await refresh()
}

async function updateActiveState(
  table,
  id,
  isActive,
  checkbox,
  refresh
) {
  checkbox.disabled = true

  const { error } = await supabase
    .from(table)
    .update({ is_active: isActive })
    .eq('id', id)

  if (error) {
    console.error(error)
    checkbox.checked = !isActive
    checkbox.disabled = false
    alert(`상태 변경 실패: ${error.message}`)
    return
  }

  await refresh()
}

function renderMemberList(
  list,
  members,
  currentMember,
  refresh
) {
  const fragment = document.createDocumentFragment()

  members.forEach((member) => {
    const item = document.createElement('div')
    item.className = 'admin-item'

    const info = document.createElement('div')
    info.className = 'admin-item-info'

    const title = document.createElement('strong')
    title.textContent =
      member.display_name === member.part
        ? member.display_name
        : `${member.display_name} · ${member.part}`

    const metadata = document.createElement('span')
    metadata.className = 'admin-item-meta'

    const roleLabel =
      member.role === 'admin' ? '관리자' : '멤버'

    const accountLabel = member.user_id
      ? '계정 연결됨'
      : '계정 미연결'

    const approvalLabel = member.is_approved
      ? '승인됨'
      : '미승인'

    metadata.textContent =
      `${roleLabel} · ${accountLabel} · ${approvalLabel}`

    info.append(title, metadata)

    const toggleLabel =
      document.createElement('label')
    toggleLabel.className = 'status-toggle'

    const checkbox =
      document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = member.is_active

    const statusText =
      document.createElement('span')

    const isCurrentMember =
      member.id === currentMember.id

    if (isCurrentMember) {
      checkbox.disabled = true
      statusText.textContent = '현재 관리자'
      toggleLabel.title =
        '현재 로그인한 관리자는 비활성화할 수 없습니다.'
    } else {
      statusText.textContent = member.is_active
        ? '사용 중'
        : '사용 중지'

      checkbox.addEventListener('change', () => {
        void updateActiveState(
          'band_members',
          member.id,
          checkbox.checked,
          checkbox,
          refresh
        )
      })
    }

    toggleLabel.append(checkbox, statusText)
    item.append(info, toggleLabel)
    fragment.append(item)
  })

  list.replaceChildren(fragment)
}

function renderCategoryList(
  list,
  categories,
  refresh
) {
  const fragment = document.createDocumentFragment()

  categories.forEach((category) => {
    const item = document.createElement('div')
    item.className = 'admin-item'

    const info = document.createElement('div')
    info.className = 'category-admin-info'

    const color = document.createElement('span')
    color.className = 'category-color'
    color.style.backgroundColor = category.color

    const name = document.createElement('strong')
    name.textContent = category.name

    info.append(color, name)

    const toggleLabel =
      document.createElement('label')
    toggleLabel.className = 'status-toggle'

    const checkbox =
      document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = category.is_active

    const statusText =
      document.createElement('span')
    statusText.textContent = category.is_active
      ? '사용 중'
      : '사용 중지'

    checkbox.addEventListener('change', () => {
      void updateActiveState(
        'practice_categories',
        category.id,
        checkbox.checked,
        checkbox,
        refresh
      )
    })

    toggleLabel.append(checkbox, statusText)
    item.append(info, toggleLabel)
    fragment.append(item)
  })

  list.replaceChildren(fragment)
}

export function renderAdminPanel({
  currentMember,
  members,
  categories,
  refresh
}) {
  const panel =
    document.querySelector('#adminPanel')

  if (
    !panel ||
    currentMember.role !== 'admin'
  ) {
    return
  }

  panel.hidden = false
  panel.innerHTML = `
    <h2>관리자 설정</h2>

    <p class="admin-description">
      사용 중지를 해도 기존 연습 기록은 삭제되지 않습니다.
      입력 목록과 차트 항목에서만 숨겨집니다.
    </p>

    <div class="admin-grid">
      <section class="admin-card">
        <h3>멤버 관리</h3>

        <form
          id="addMemberForm"
          class="admin-form"
        >
          <div class="form-group">
            <label for="adminMemberName">
              멤버 이름
            </label>

            <input
              id="adminMemberName"
              name="displayName"
              maxlength="100"
              placeholder="예: 김기타"
              required
            >
          </div>

          <div class="form-group">
            <label for="adminMemberPart">
              파트
            </label>

            <input
              id="adminMemberPart"
              name="part"
              maxlength="100"
              placeholder="예: 기타"
              required
            >
          </div>

          <button
            class="admin-add-button"
            type="submit"
          >
            멤버 추가
          </button>
        </form>

        <div
          id="adminMemberList"
          class="admin-list"
        ></div>
      </section>

      <section class="admin-card">
        <h3>카테고리 관리</h3>

        <form
          id="addCategoryForm"
          class="admin-form"
        >
          <div class="form-group">
            <label for="adminCategoryName">
              카테고리 이름
            </label>

            <input
              id="adminCategoryName"
              name="categoryName"
              maxlength="100"
              placeholder="예: 리듬 연습"
              required
            >
          </div>

          <div class="form-group">
            <label for="adminCategoryColor">
              표시 색상
            </label>

            <input
              id="adminCategoryColor"
              name="categoryColor"
              type="color"
              value="#3498db"
              required
            >
          </div>

          <button
            class="admin-add-button"
            type="submit"
          >
            카테고리 추가
          </button>
        </form>

        <div
          id="adminCategoryList"
          class="admin-list"
        ></div>
      </section>
    </div>
  `

  renderMemberList(
    document.querySelector('#adminMemberList'),
    members,
    currentMember,
    refresh
  )

  renderCategoryList(
    document.querySelector('#adminCategoryList'),
    categories,
    refresh
  )

  document
    .querySelector('#addMemberForm')
    .addEventListener('submit', (event) => {
      void handleAddMember(
        event,
        members,
        refresh
      )
    })

  document
    .querySelector('#addCategoryForm')
    .addEventListener('submit', (event) => {
      void handleAddCategory(
        event,
        categories,
        refresh
      )
    })
}