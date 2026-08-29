import LegalPage from "@/components/LegalPage";
import styles from "@/components/LegalPage.module.css";

export const metadata = {
  title: "Términos de Servicio — Colecciona",
};

export default function TerminosPage() {
  return (
    <LegalPage title="Términos de Servicio" updated="5 de agosto de 2026">
      <Section title="1. Información del responsable y aceptación">
        <p>
          Colecciona es una plataforma operada por{" "}
          <strong>[Nombre legal de tu empresa o de tu nombre completo]</strong>,
          con domicilio en <strong>[Dirección completa]</strong>, NIF/CIF{" "}
          <strong>[NIF o CIF]</strong> e inscrita en{" "}
          <strong>[Registro Mercantil, si aplica]</strong> (en adelante,
          «Colecciona» o «nosotros»). Contacto:{" "}
          <a href="mailto:soporte@colecciona.app">[email de contacto real]</a>.
        </p>
        <p>
          Estos Términos de Servicio («Términos») regulan el acceso y el uso de la
          plataforma, así como la compra y venta de cartas coleccionables
          («artículos») entre usuarios. Al crear una cuenta o utilizar la
          plataforma aceptas íntegramente estos Términos y nuestra{" "}
          <a href="/privacidad">Política de Privacidad</a>. Si no estás de acuerdo,
          no utilices la plataforma.
        </p>
      </Section>

      <Section title="2. Definiciones">
        <ul>
          <li>
            <strong>Plataforma:</strong> la aplicación, el sitio web y todos los
            servicios de Colecciona.
          </li>
          <li>
            <strong>Usuario:</strong> cualquier persona que utilice la plataforma,
            ya sea comprador, vendedor o ambos.
          </li>
          <li>
            <strong>Artículo:</strong> carta coleccionable u objeto relacionado
            publicado en la plataforma.
          </li>
          <li>
            <strong>Fondos en custodia («escrow»):</strong> el importe retenido por
            Colecciona hasta que se completa la transacción.
          </li>
        </ul>
      </Section>

      <Section title="3. Registro y elegibilidad">
        <ul>
          <li>
            Para usar la plataforma debes tener al menos 14 años (o la edad mínima
            exigida por la legislación de tu país) y, si eres menor de edad legal,
            contar con autorización de tu representante legal.
          </li>
          <li>Solo se permite una cuenta personal por persona y por número de teléfono.</li>
          <li>
            Están prohibidas las cuentas múltiples, ficticias, automatizadas (bots)
            o creadas para eludir sanciones.
          </li>
          <li>
            Eres responsable de mantener la confidencialidad de tus credenciales y
            de toda la actividad realizada con tu cuenta. Debes notificarnos
            cualquier uso no autorizado.
          </li>
          <li>
            Los datos de registro deben ser veraces, completos y actualizados.
          </li>
        </ul>
      </Section>

      <Section title="4. Verificación y sistema anti-fraude">
        <p>
          Colecciona aplica medidas de verificación de identidad y prevención del
          fraude, incluida la verificación telefónica por SMS y el análisis
          automatizado de comportamiento. Te comprometes a cooperar con dichas
          comprobaciones, a no suplantar a terceros y a no intentar crear más de una
          cuenta activa. Podemos suspender cuentas que incumplan estas medidas, en
          protección de la comunidad.
        </p>
      </Section>

      <Section title="5. Publicación de artículos y normas de contenido">
        <ul>
          <li>
            Solo podrás publicar artículos auténticos, legales y de tu propiedad o
            de cuya venta tengas derecho.
          </li>
          <li>
            Debes describir con exactitud el estado, la edición, la gradación
            (PSA/BGS/CGC u otras), el idioma y cualquier defecto o desgaste de cada
            artículo, y usar imágenes que representen fielmente el artículo real.
          </li>
          <li>
            Queda prohibido publicar falsificaciones, réplicas, reproducciones no
            autorizadas, artículos robados, ilícitos o que infrinjan derechos de
            terceros.
          </li>
          <li>
            Las imágenes, títulos y descripciones deben ser propios o estar
            debidamente autorizados.
          </li>
          <li>
            Podemos retirar cualquier publicación que infrinja estos Términos o la
            ley sin previo aviso y sin perjuicio de las consecuencias previstas.
          </li>
        </ul>
      </Section>

      <Section title="6. Autenticidad y garantías de los artículos">
        <p>
          <strong>
            IMPORTANTE: Colecciona no certifica ni garantiza la autenticidad, el
            estado, la gradación ni el valor de los artículos publicados por los
            usuarios.
          </strong>{" "}
          El vendedor es el único responsable de la veracidad de sus publicaciones y
          el comprador acepta adquirir los artículos «tal cual» según lo descrito
          por el vendedor. La gradación de una carta es una opinión técnica de la
          entidad de gradación correspondiente y no una garantía de Colecciona.
          Recomendamos verificar la reputación del vendedor, su historial y la
          documentación del artículo antes de comprar.
        </p>
      </Section>

      <Section title="7. Compra, pago y custodia de fondos">
        <p>
          Al confirmar una compra, celebras un contrato de compraventa directamente
          con el vendedor. Colecciona actúa como intermediario tecnológico y de
          pago, y no es parte vendedora de los artículos.
        </p>
        <ul>
          <li>
            El pago se retiene en custodia hasta que el comprador confirma la
            recepción del artículo en las condiciones descritas.
          </li>
          <li>
            Si el comprador no confirma la recepción, la transacción se resolverá
            conforme al sistema de reclamaciones de la plataforma.
          </li>
          <li>
            No se liberan fondos al vendedor hasta la finalización correcta de la
            transacción.
          </li>
        </ul>
      </Section>

      <Section title="8. Comisiones, gastos e impuestos">
        <ul>
          <li>
            Colecciona puede aplicar comisiones por venta y gastos de gestión o de
            envío, que se comunicarán antes de confirmar la transacción.
          </li>
          <li>
            Los precios pueden incluir o no impuestos (IVA u otros) según la
            normativa aplicable; la carga impositiva corresponderá a quien la
            establezca la ley.
          </li>
          <li>
            Es responsabilidad del vendedor cumplir con sus obligaciones fiscales
            derivadas de sus ventas.
          </li>
        </ul>
      </Section>

      <Section title="9. Envíos y entregas">
        <ul>
          <li>El vendedor debe enviar el artículo en el plazo indicado en su publicación.</li>
          <li>El envío debe ser seguro y con seguimiento cuando la transacción lo requiera.</li>
          <li>
            El riesgo de pérdida o daño durante el transporte corresponde al
            vendedor hasta la entrega, salvo acuerdo en contrario.
          </li>
        </ul>
      </Section>

      <Section title="10. Devoluciones, reclamaciones y desistimiento">
        <ul>
          <li>
            Si el artículo no coincide con lo descrito, llega dañado o no llega, el
            comprador podrá abrir una reclamación en el plazo indicado en la
            plataforma.
          </li>
          <li>
            Cuando el comprador actúe como consumidor, se respetará el derecho de
            desistimiento en los términos previstos por la normativa de protección
            al consumidor (14 días naturales, con las excepciones legalmente
            aplicables a artículos personalizados o de coleccionismo cuando
            proceda).
          </li>
          <li>
            Las reclamaciones se resolverán conforme al procedimiento interno de la
            plataforma y a la documentación aportada por ambas partes.
          </li>
        </ul>
      </Section>

      <Section title="11. Resolución de disputas entre usuarios">
        <p>
          Antes de acudir a los tribunales, las partes intentarán resolver sus
          discrepancias mediante el sistema de reclamaciones de la plataforma, con
          la mediación de Colecciona. Colecciona podrá decidir sobre la liberación o
          la devolución de los fondos en custodia atendiendo a la información
          disponible y de buena fe. Esta decisión no exime a las partes de sus
          responsabilidades legales.
        </p>
      </Section>

      <Section title="12. Conducta prohibida">
        <p>
          Queda prohibido, entre otros: publicar contenido falso, fraudulento,
          ilegal o que infrinja derechos de terceros; realizar transacciones fuera
          de la plataforma para eludir comisiones o garantías; intentar acceder sin
          autorización a sistemas o cuentas ajenas; acosar, amenazar o defraudar a
          otros usuarios; manipular valoraciones, precios o subastas; suplantar la
          identidad; y usar la plataforma para actividades de blanqueo de capitales
          o financiación ilegal.
        </p>
      </Section>

      <Section title="13. Propiedad intelectual">
        <p>
          Colecciona, sus marcas, logotipos, textos, software, base de datos y
          diseño son titularidad de sus respectivos propietarios y están protegidos
          por la normativa de propiedad intelectual. Los usuarios no adquieren
          ningún derecho sobre la plataforma más allá del uso permitido por estos
          Términos. Al publicar contenido, concedes a Colecciona una licencia
          limitada, no exclusiva y revocable para alojarlo, mostrarlo y gestionarlo
          dentro de la plataforma.
        </p>
      </Section>

      <Section title="14. Licencia de uso de la plataforma">
        <p>
          Te concedemos una licencia limitada, no exclusiva, intransferible y
          revocable para usar la plataforma conforme a estos Términos. Queda
          prohibido copiar, modificar, descompilar, extraer datos de forma masiva o
          utilizar la plataforma para fines distintos a los previstos.
        </p>
      </Section>

      <Section title="15. Exoneración de garantías">
        <p>
          La plataforma se presta «tal cual» y «según disponibilidad». En la medida
          máxima permitida por la ley, Colecciona no garantiza que la plataforma
          funcione sin interrupciones ni errores, ni garantiza la autenticidad,
          calidad o valor de los artículos ofertados por terceros usuarios.
        </p>
      </Section>

      <Section title="16. Limitación de responsabilidad">
        <p>
          Colecciona actúa como intermediario y, en la medida máxima permitida por
          la ley, no será responsable de los daños indirectos, lucro cesante o
          pérdidas derivadas del uso de la plataforma o de las transacciones entre
          usuarios. Nuestra responsabilidad total se limitará, en su caso, al
          importe pagado por el usuario en los doce meses anteriores a la
          reclamación. Esta limitación no excluye la responsabilidad por dolo,
          culpa grave, daños a la salud o cuando la ley no la permita.
        </p>
      </Section>

      <Section title="17. Indemnización">
        <p>
          Aceptas indemnizar y mantener indemne a Colecciona frente a cualquier
          reclamación, daño o gasto derivado de tu uso de la plataforma, de tus
          publicaciones, de tus transacciones o del incumplimiento de estos
          Términos o de la ley.
        </p>
      </Section>

      <Section title="18. Disponibilidad y cambios del servicio">
        <p>
          Podemos modificar, interrumpir o retirar funcionalidades de la plataforma
          en cualquier momento por motivos de mantenimiento, seguridad o de negocio.
          Te avisaremos cuando sea razonablemente posible. No somos responsables de
          la indisponibilidad debida a causas ajenas a nuestro control.
        </p>
      </Section>

      <Section title="19. Suspensión, bloqueo y baja de cuentas">
        <p>
          Podemos suspender, limitar o cerrar cuentas que incumplan estos Términos,
          la ley, o que pongan en riesgo la seguridad de la plataforma o de otros
          usuarios, con o sin previo aviso. El usuario puede cerrar su cuenta en
          cualquier momento desde su perfil. Las obligaciones de pago y de
          resolución de transacciones pendientes sobrevivirán a la baja de la cuenta.
        </p>
      </Section>

      <Section title="20. Fuerza mayor">
        <p>
          No seremos responsables por el incumplimiento de obligaciones causado por
          circunstancias ajenas a nuestro control razonable (catástrofes naturales,
          huelgas, fallos de telecomunicaciones, actos de autoridades u otros).
        </p>
      </Section>

      <Section title="21. Modificaciones de los Términos">
        <p>
          Podemos actualizar estos Términos periódicamente. Los cambios se publicarán
          en esta página con su fecha de actualización y, si fueran sustanciales, te
          lo comunicaremos por los medios disponibles. El uso continuado de la
          plataforma tras la publicación de los cambios implica su aceptación.
        </p>
      </Section>

      <Section title="22. Cesión y divisibilidad">
        <p>
          No podrás ceder tus derechos u obligaciones derivados de estos Términos
          sin nuestro consentimiento. Si alguna cláusula resultara nula o inaplicable,
          las restantes mantendrán su validez y se sustituirá la cláusula afectada
          por otra que refleje lo más fielmente posible la intención de las partes.
        </p>
      </Section>

      <Section title="23. Legislación aplicable y jurisdicción">
        <p>
          Estos Términos se rigen por la legislación española. Las partes se someten
          a la jurisdicción de los juzgados de{" "}
          <strong>[tu ciudad, p. ej. Madrid]</strong>, salvo disposición legal
          imperativa que atribuya otro fuero. En el ámbito de la Unión Europea, el
          consumidor puede acudir a la plataforma de resolución de litigios en línea
          de la Comisión Europea (https://ec.europa.eu/consumers/odr).
        </p>
      </Section>

      <Section title="24. Contacto">
        <p>
          Para cualquier duda sobre estos Términos, escríbenos a{" "}
          <a href="mailto:soporte@colecciona.app">[email real de soporte]</a>.
        </p>
      </Section>
    </LegalPage>
  );
}

function Section({ title, children }) {
  return (
    <div className={styles.section}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}