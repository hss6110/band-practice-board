import './style.css'
import { supabase } from './supabase.js'

const app = document.querySelector('#app')

function attachLogoutButton() {
  document
    .querySelector('#logoutButton')
    ?.addEventListener('click', signOut)
}

async function render(session) {
  if (!session) {
    app.innerHTML = `
      <h1>밴드 연습 기록소</h1>
      <p>밴드원 계정으로 로그인해주세요.</p>
      <button id="loginButton" type="button">
        GitHub로 로그인
      </button>
    `

    document
      .querySelector('#loginButton')
      .addEventListener('click', signInWithGitHub)

    return
  }

  app.innerHTML = `
    <h1>밴드 연습 기록소</h1>
    <p>밴드원 정보를 확인하고 있습니다.</p>
  `

  const [membersResult, categoriesResult] = await Promise.all([
    supabase
      .from('band_members')
      .select(`
        id,
        user_id,
        display_name,
        part,
        role,
        is_approved,
        is_active,
        sort_order
      `)
      .order('sort_order'),

    supabase
      .from('practice_categories')
      .select(`
        id,
        name,
        color,
        is_active,
        sort_order
      `)
      .order('sort_order')
  ])

  if (membersResult.error || categoriesResult.error) {
    const error =
      membersResult.error ?? categoriesResult.error

    app.innerHTML = `
      <h1>밴드 연습 기록소</h1>
      <p>데이터 조회에 실패했습니다.</p>
      <p id="errorMessage"></p>
      <button id="logoutButton" type="button">
        로그아웃
      </button>
    `

    document.querySelector('#errorMessage').textContent =
      error.message

    attachLogoutButton()
    return
  }

  const members = membersResult.data
  const categories = categoriesResult.data

  const currentMember = members.find(
    (member) => member.user_id === session.user.id
  )

  if (!currentMember) {
    app.innerHTML = `
      <h1>밴드 연습 기록소</h1>
      <p>GitHub 로그인은 완료됐습니다.</p>
      <p>아직 밴드원 승인을 받지 않은 계정입니다.</p>
      <button id="logoutButton" type="button">
        로그아웃
      </button>
    `

    attachLogoutButton()
    return
  }

  const metadata = session.user.user_metadata
  const username =
    metadata.user_name ??
    metadata.preferred_username ??
    metadata.name ??
    session.user.email ??
    '사용자'

  app.innerHTML = `
    <h1>밴드 연습 기록소</h1>

    <p>
      GitHub 계정:
      <strong id="githubUsername"></strong>
    </p>

    <p>
      연결된 멤버:
      <strong id="memberName"></strong>
    </p>

    <p>
      권한:
      <strong id="memberRole"></strong>
    </p>

    <p id="connectionResult"></p>

    <button id="logoutButton" type="button">
      로그아웃
    </button>
  `

  document.querySelector('#githubUsername').textContent =
    username

  document.querySelector('#memberName').textContent =
    currentMember.display_name

  document.querySelector('#memberRole').textContent =
    currentMember.role

  document.querySelector('#connectionResult').textContent =
    `데이터베이스 연결 성공: 멤버 ${members.length}명, 카테고리 ${categories.length}개`

  attachLogoutButton()
}

async function signInWithGitHub() {
  const redirectTo = new URL(
    import.meta.env.BASE_URL,
    window.location.origin
  ).toString()

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo
    }
  })

  if (error) {
    console.error(error)
    alert(`GitHub 로그인 실패: ${error.message}`)
  }
}

async function signOut() {
  const { error } = await supabase.auth.signOut()

  if (error) {
    console.error(error)
    alert(`로그아웃 실패: ${error.message}`)
  }
}

const {
  data: { session },
  error
} = await supabase.auth.getSession()

if (error) {
  console.error(error)
  app.textContent = `로그인 상태 확인 실패: ${error.message}`
} else {
  await render(session)
}

supabase.auth.onAuthStateChange((_event, session) => {
  window.setTimeout(() => {
    void render(session)
  }, 0)
})